/**
 * The CMS page and crawlers: robots.txt has to let crawlers fetch /admin/ so that they see its
 * noindex, and the page has to load one exact Sveltia CMS build, checked with Subresource Integrity,
 * under a Content-Security-Policy that pins what it may import later to exact versions.
 * Run: node --test tests/admin.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { decodeEntities, parsePolicy } from '../src/integrations/csp.ts';
import { GET } from '../src/pages/robots.txt.ts';

describe('robots.txt', () => {
  test('lets crawlers fetch everything, /admin/ included, and lists the sitemap', async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
    const lines = (await response.text()).split('\n');
    for (const line of ['User-agent: *', 'Allow: /', 'Sitemap: https://roshandash.com/sitemap-index.xml']) {
      assert.ok(lines.includes(line), line);
    }
    const disallowed = lines.filter((line) => /^disallow:/i.test(line)).map((line) => line.slice('disallow:'.length).trim());
    assert.deepEqual(disallowed.filter((path) => path && '/admin/'.startsWith(path)), []);
  });
});

describe('/admin/ page', () => {
  const html = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');

  test('is noindex, which is all that keeps it out of search results', () => {
    assert.match(html, /<meta name="robots" content="noindex\b[^"]*"/);
  });

  test('loads one exact Sveltia CMS version, with Subresource Integrity', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    assert.equal(scripts.length, 1);
    const [tag] = scripts;
    assert.match(tag, /\ssrc="https:\/\/unpkg\.com\/@sveltia\/cms@\d+\.\d+\.\d+\/dist\/sveltia-cms\.js"/);
    assert.match(tag, /\sintegrity="sha384-[A-Za-z0-9+/]{64}"/);
    assert.match(tag, /\scrossorigin="anonymous"/);
    assert.doesNotMatch(tag, /\stype="module"/); // Sveltia ships a classic script
  });

  test('has its own Content-Security-Policy, before the script: no inline script or eval, only pinned unpkg versions', () => {
    const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
    assert.ok(meta, 'policy meta');
    assert.ok(html.indexOf(meta[0]) < html.indexOf('<script'), 'the policy comes before the script');
    const policy = parsePolicy(decodeEntities(meta[1]));
    assert.deepEqual(policy.get('default-src'), ["'none'"]);
    assert.deepEqual(policy.get('object-src'), ["'none'"]);
    const scripts = policy.get('script-src') ?? [];
    assert.ok(!scripts.some((source) => ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", 'https:', '*', 'https://unpkg.com'].includes(source)));
    const src = /<script\b[^>]*\ssrc="([^"]+)"/.exec(html)?.[1] ?? '';
    const version = /@sveltia\/cms@(\d+\.\d+\.\d+)\//.exec(src)?.[1];
    assert.ok(scripts.includes(`https://unpkg.com/@sveltia/cms@${version}/`), 'the CMS version the script loads');
    for (const source of scripts.filter((s) => s.startsWith('https://'))) {
      assert.match(source, /^https:\/\/unpkg\.com\/(?:@[a-z0-9-]+\/)?[a-z0-9.-]+@(?:\d+\.\d+\.\d+\/|%5E[\d.]+)$/, source);
    }
  });
});
