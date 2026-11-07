/**
 * The Content-Security-Policy pass (src/integrations/csp.ts): every inline script, <style> element and style
 * attribute a page has is hashed into that page's policy, and nothing else is let in.
 * Run: node --test tests/csp.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { applyCsp, decodeEntities, pagePolicy, parsePolicy, scanHtml, sha256 } from '../src/integrations/csp.ts';

const hash = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
const page = (head: string, body = '') =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const directive = (policy: string, name: string) => parsePolicy(policy).get(name);

describe('scanHtml', () => {
  test('inline scripts that run, whatever their type; never external ones or JSON data blocks', () => {
    const scan = scanHtml(
      page(
        '<script>(function(){document.documentElement.dataset.theme="dark"})();</script>' +
          '<script type="module">import "./a.js";</script><script type="text/javascript">a()</script>' +
          '<script type="application/ld+json">{"@type":"Person"}</script><script type="module" src="/_astro/x.js"></script>',
        '<script type="application/json" data-palette-data>{"a":"\\u003c/script>"}</script>' +
          '<script type="importmap">{}</script>',
      ),
    );
    assert.deepEqual(scan.scripts, [
      '(function(){document.documentElement.dataset.theme="dark"})();',
      'import "./a.js";',
      'a()',
      '{}',
    ]);
  });

  test('style elements as written, style attributes as the browser reads them (empty ones too)', () => {
    const scan = scanHtml(
      page(
        '<style>@font-face{font-family:"Inter"}</style>',
        '<h1 style="--lsb:0.054">A</h1><span style="font-family:&quot;X&quot;;content:&#39;a&#39;">b</span><i style="">c</i>',
      ),
    );
    assert.deepEqual(scan.styles, ['@font-face{font-family:"Inter"}']);
    assert.deepEqual(scan.styleAttrs, ['--lsb:0.054', `font-family:"X";content:'a'`, '']);
  });

  test('raw text is not markup: a "<style" or style= inside a script, a title or a comment counts for nothing', () => {
    const scan = scanHtml(
      page(
        '<title>&lt;style&gt; and style="x"</title>' +
          '<script>const s = "<style>a{}</style> <b style=\'x\'>";</script><!-- <style>c{}</style> -->',
      ),
    );
    assert.deepEqual(scan.styles, []);
    assert.deepEqual(scan.styleAttrs, []);
    assert.equal(scan.scripts.length, 1);
  });

  test('inside inline SVG a <style> is an ordinary element: its text, entities decoded', () => {
    const svg = '<svg viewBox="0 0 1 1"><style>.a{fill:red}</style><style/><path class="a" d="M0 0" style="opacity:.5"/></svg>';
    const scan = scanHtml(page('', `${svg}<style>p{}</style>`));
    assert.deepEqual(scan.styles, ['.a{fill:red}', 'p{}']);
    assert.deepEqual(scan.styleAttrs, ['opacity:.5']);
    assert.throws(() => scanHtml(page('', '<svg><style><![CDATA[.a{}]]></style></svg>')), /SVG/);
  });

  test('finds data-csp extensions and inline event handlers', () => {
    const scan = scanHtml(
      page('', `<figure data-csp="frame-src https://embed.example; style-src &#39;unsafe-inline&#39;"></figure>` +
        '<button onclick="x()">x</button>'),
    );
    assert.deepEqual(scan.extensions, ["frame-src https://embed.example; style-src 'unsafe-inline'"]);
    assert.deepEqual(scan.handlers, ['<button onclick>']);
  });

  test('the policy goes right after <meta charset>, which has to open <head>', () => {
    const html = page('<meta name="viewport" content="width=device-width">');
    assert.equal(html.slice(0, scanHtml(html).insertAt).endsWith('<meta charset="utf-8">'), true);
    assert.equal(scanHtml('<html><head><title>x</title><meta charset="utf-8"></head></html>').insertAt, -1);
  });
});

describe('pagePolicy', () => {
  const scan = (over: Partial<ReturnType<typeof scanHtml>> = {}) => ({ ...scanHtml(page('')), ...over });

  test('the site policy, with each inline thing hashed into its own directive', () => {
    const policy = pagePolicy(scan({ scripts: ['a()', 'a()'], styles: ['p{}'], styleAttrs: ['--i:1', '--i:1', '--i:2'] }));
    assert.deepEqual(directive(policy, 'script-src'), ["'self'", "'wasm-unsafe-eval'", hash('a()')]);
    assert.deepEqual(directive(policy, 'style-src'), ["'self'", hash('p{}')]);
    assert.deepEqual(directive(policy, 'style-src-attr'), ["'unsafe-hashes'", hash('--i:1'), hash('--i:2')]);
    const fixed = {
      'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'font-src': ["'self'"], 'connect-src': ["'self'"],
      'worker-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"], 'form-action': ["'self'", 'mailto:'],
    };
    for (const [name, sources] of Object.entries(fixed)) assert.deepEqual(directive(policy, name), sources, name);
    assert.doesNotMatch(policy, /'unsafe-inline'|'unsafe-eval'/);
  });

  test("no style attributes: style-src-attr 'none'", () => {
    assert.deepEqual(directive(pagePolicy(scan()), 'style-src-attr'), ["'none'"]);
  });

  test("a component's data-csp adds sources to its page; 'unsafe-inline' keeps hashes out of that directive", () => {
    const extension = "script-src https://cdn.example; frame-src https://embed.example; style-src 'unsafe-inline'";
    const policy = pagePolicy(scan({ styles: ['p{}'], styleAttrs: ['--i:1'], extensions: [extension] }));
    assert.deepEqual(directive(policy, 'script-src'), ["'self'", "'wasm-unsafe-eval'", 'https://cdn.example']);
    assert.deepEqual(directive(policy, 'frame-src'), ['https://embed.example']);
    assert.deepEqual(directive(policy, 'style-src'), ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(directive(policy, 'style-src-attr'), ["'unsafe-hashes'", hash('--i:1')]);
  });

  test('data-csp can never open scripts up or touch the rest of the policy', () => {
    const attempts = [
      "script-src 'unsafe-inline'", "script-src 'unsafe-eval'", 'script-src data:', 'img-src *', "object-src 'self'",
      'base-uri https://x.example',
    ];
    for (const extension of attempts) assert.throws(() => pagePolicy(scan({ extensions: [extension] })), /data-csp/, extension);
  });
});

describe('applyCsp', () => {
  const html = page(
    '<meta name="viewport" content="width=device-width"><script>boot()</script><style>p{}</style>',
    '<h1 style="--lsb:0.054">Roshan</h1>',
  );

  test('one meta, second in <head>, with the hashes of exactly this page', () => {
    const { html: out, policy } = applyCsp(html);
    const head = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"';
    assert.ok(out.startsWith(head));
    assert.match(out, /<meta http-equiv="Content-Security-Policy" content="[^"]+"><meta name="viewport"/);
    assert.equal(out.match(/Content-Security-Policy/g)?.length, 1);
    assert.ok(directive(policy, 'script-src')?.includes(hash('boot()')));
    assert.ok(directive(policy, 'style-src')?.includes(hash('p{}')));
    assert.ok(directive(policy, 'style-src-attr')?.includes(hash('--lsb:0.054')));
    assert.equal(sha256('boot()'), hash('boot()'));
  });

  test('idempotent: a second pass replaces the policy instead of adding one', () => {
    const once = applyCsp(html).html;
    assert.equal(applyCsp(once).html, once);
  });

  test('fails the build rather than ship a page the policy would break', () => {
    assert.throws(() => applyCsp(page('', '<a href="#" onclick="go()">x</a>')), /event handlers/);
    assert.throws(() => applyCsp('<html><head><title>x</title></head></html>'), /meta charset/);
  });
});

describe('decodeEntities', () => {
  test('numeric and the common named references; anything else is refused', () => {
    assert.equal(decodeEntities('&lt;&amp;&gt;&quot;&#39;&#x27;&apos;&nbsp;'), `<&>"'''\u00a0`);
    assert.throws(() => decodeEntities('&hellip;'), /unsupported/);
  });
});
