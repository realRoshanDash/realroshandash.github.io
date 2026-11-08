/**
 * The Content-Security-Policy pass (src/integrations/csp.ts): every inline script, <style> element and style
 * attribute a page has is hashed into that page's policy, and nothing else is let in.
 * Run: node --test tests/csp.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { allows, applyCsp, decodeEntities, pagePolicy, parsePolicy, scanHtml, sha256, srcsetUrls } from '../src/integrations/csp.ts';

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

  test('fails the build on markup that loads from an origin its policy blocks (a badge image, an embedded video)', () => {
    const badge = '<p><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="build status"></p>';
    assert.throws(() => applyCsp(page('', badge)), /<img src> https:\/\/img\.shields\.io\/\S+ \(img-src 'self' data:\)/);
    const video = '<iframe src="https://www.youtube-nocookie.com/embed/abc" title="Talk"></iframe>';
    // no frame-src in the policy: default-src decides
    assert.throws(() => applyCsp(page('', video)), /<iframe src> https:\/\/www\.youtube-nocookie\.com\/embed\/abc \(default-src 'self'\)/);
    const candidates = '<picture><source srcset="/a.avif 1x, https://cdn.example/b.avif 2x"><img src="/a.jpg" alt=""></picture>';
    assert.throws(() => applyCsp(page('', candidates)), /<source srcset> https:\/\/cdn\.example\/b\.avif/);
    assert.throws(() => applyCsp(page('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')), /style-src/);
    assert.throws(() => applyCsp(page('<script type="module" src="https://cdn.example/x.js"></script>')), /script-src/);
    assert.throws(() => applyCsp(page('', '<object data="/doc.pdf"></object>')), /object-src 'none'/);
    assert.throws(() => applyCsp(page('', '<form action="https://forms.example/submit"></form>')), /form-action/);
  });

  test("what the site loads itself passes: relative and same-origin URLs, data: images, the font preload, a component's data-csp origin", () => {
    const ok = page(
      '<link rel="preload" href="/_astro/fonts/a.woff2" as="font" type="font/woff2" crossorigin>' +
        '<link rel="icon" href="/favicon.svg"><link rel="manifest" href="/site.webmanifest">' +
        '<link rel="stylesheet" href="/_astro/index.css"><script type="module" src="/_astro/page.js"></script>',
      '<picture><source type="image/avif" srcset="/_astro/a_1.avif 640w, /_astro/a_2.avif 960w" sizes="100vw">' +
        '<img src="https://roshandash.com/_astro/a_2.webp" srcset="/_astro/a_1.webp 640w,/_astro/a_2.webp 960w" alt=""></picture>' +
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><a href="https://github.com/realRoshanDash">GitHub</a>' +
        '<form action="mailto:someone"></form><iframe src="about:blank" title="x"></iframe>' +
        '<figure data-csp="frame-src https://www.youtube-nocookie.com"><iframe src="https://www.youtube-nocookie.com/embed/abc" title="Talk"></iframe></figure>',
    );
    assert.doesNotThrow(() => applyCsp(ok));
  });
});

describe('allows', () => {
  const self = new URL('https://roshandash.com');
  const policy = (text: string) => parsePolicy(text);
  const url = (href: string) => new URL(href, self);

  test("'self', schemes, hosts with wildcards, ports and paths, as CSP matches them", () => {
    const p = policy(
      "default-src 'self'; img-src 'self' data: https://*.githubusercontent.com; script-src https://unpkg.com/@sveltia/cms@0.261.0/ https://cdn.example/one.js",
    );
    assert.ok(allows(p, 'img-src', url('/x.png'), self));
    assert.ok(allows(p, 'img-src', url('data:image/png;base64,AA=='), self));
    assert.ok(allows(p, 'img-src', url('https://avatars.githubusercontent.com/u/1'), self));
    assert.ok(!allows(p, 'img-src', url('https://githubusercontent.com.evil.example/x'), self));
    assert.ok(!allows(p, 'img-src', url('http://avatars.githubusercontent.com/u/1'), self), 'no downgrade to http');
    assert.ok(allows(p, 'script-src-elem', url('https://unpkg.com/@sveltia/cms@0.261.0/dist/chunks/git.js'), self));
    assert.ok(!allows(p, 'script-src-elem', url('https://unpkg.com/@sveltia/cms@0.262.0/dist/sveltia-cms.js'), self));
    assert.ok(allows(p, 'script-src-elem', url('https://cdn.example/one.js'), self));
    assert.ok(!allows(p, 'script-src-elem', url('https://cdn.example/two.js'), self));
    assert.ok(!allows(p, 'script-src-elem', url('https://cdn.example:8443/one.js'), self));
    assert.ok(allows(p, 'font-src', url('/f.woff2'), self), 'falls back to default-src');
    assert.ok(!allows(policy("object-src 'none'"), 'object-src', url('/a.swf'), self));
    // paths compare percent-decoded on both sides (a version range in a source path has to be written %5E)
    const range = policy('script-src https://unpkg.com/wasm-feature-detect@%5E1.2.11');
    assert.ok(allows(range, 'script-src-elem', url('https://unpkg.com/wasm-feature-detect@^1.2.11?module'), self));
    assert.ok(!allows(range, 'script-src-elem', url('https://unpkg.com/wasm-feature-detect@^2.0.0?module'), self));
  });

  test('srcset candidates: URLs only, with or without descriptors and spaces', () => {
    assert.deepEqual(srcsetUrls('/a.avif 640w, /b.avif 960w'), ['/a.avif', '/b.avif']);
    assert.deepEqual(srcsetUrls('/a.webp 1x,/b.webp 2x'), ['/a.webp', '/b.webp']);
    assert.deepEqual(srcsetUrls('/a.webp, /b.webp'), ['/a.webp', '/b.webp']);
    // as browsers parse it: a comma inside a run of non-space characters is part of the URL
    assert.deepEqual(srcsetUrls('/a.webp,/b.webp 2x'), ['/a.webp,/b.webp']);
    assert.deepEqual(srcsetUrls('  https://x.example/a.png  '), ['https://x.example/a.png']);
  });
});

describe('decodeEntities', () => {
  test('numeric and the common named references; anything else is refused', () => {
    assert.equal(decodeEntities('&lt;&amp;&gt;&quot;&#39;&#x27;&apos;&nbsp;'), `<&>"'''\u00a0`);
    assert.throws(() => decodeEntities('&hellip;'), /unsupported/);
  });
});
