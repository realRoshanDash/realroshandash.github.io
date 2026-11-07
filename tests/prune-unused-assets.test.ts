/**
 * The build drops every asset nothing refers to (src/integrations/prune-unused-assets.ts): the dormant sections'
 * stylesheets, scripts no page loads, and a draft post's photos, which Astro copies into dist/_astro (the cover
 * byte for byte, metadata and all) even though the draft gets no page.
 * Run: node --test tests/prune-unused-assets.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unreferencedAssets } from '../src/integrations/prune-unused-assets.ts';

test('keeps stylesheets that a page links, CSS imports or a script preloads; drops the rest', () => {
  const sheets = ['/d/_astro/index.A1.css', '/d/_astro/_..B2.css', '/d/_astro/shared.C3.css', '/d/_astro/lazy.D4.css'];
  const sources = [
    { path: '/d/index.html', text: '<link rel="stylesheet" href="/_astro/index.A1.css">' },
    { path: '/d/_astro/index.A1.css', text: '@import "./shared.C3.css";' },
    { path: '/d/_astro/page.js', text: '__vitePreload(() => import("./x.js"), ["_astro/lazy.D4.css"])' },
    // A file mentioning its own name doesn't keep itself alive.
    { path: '/d/_astro/_..B2.css', text: '.tcard{} /*# sourceMappingURL=_..B2.css.map */' },
  ];
  assert.deepEqual(unreferencedAssets(sheets, sources), ['/d/_astro/_..B2.css']);
});

test("a draft post's photos and a script no page loads go; a published post's images stay", () => {
  // What `astro build` leaves when one post with a cover and an inline image is published and a draft with both
  // is not: Astro emits the draft's original cover (image() in the schema imports it), the draft's derivatives
  // are never generated because no page renders it, and Expressive Code's copy script ships with no code block.
  const assets = [
    '/d/_astro/published-cover.Ab12.jpg',
    '/d/_astro/published-cover.Ab12_Z1x9.avif',
    '/d/_astro/published-cover.Ab12_Z2y8.webp',
    '/d/_astro/inline.Cd34_Z3z7.webp',
    '/d/_astro/draft-cover.Ef56.jpg',
    '/d/_astro/draft-inline.Gh78.png',
    '/d/_astro/ec.0vx5m.js',
  ];
  const sources = [
    {
      path: '/d/blog/published/index.html',
      text:
        '<picture><source type="image/avif" srcset="/_astro/published-cover.Ab12_Z1x9.avif 640w" sizes="100vw">' +
        '<img src="/_astro/published-cover.Ab12_Z2y8.webp" srcset="/_astro/published-cover.Ab12_Z2y8.webp 640w"></picture>' +
        '<p><img src="/_astro/inline.Cd34_Z3z7.webp" alt=""></p>',
    },
    // the published post's own original isn't linked either: its page uses only the resized copies
    { path: '/d/sitemap-0.xml', text: '<loc>https://roshandash.com/blog/published/</loc>' },
  ];
  assert.deepEqual(unreferencedAssets(assets, sources), [
    '/d/_astro/published-cover.Ab12.jpg',
    '/d/_astro/draft-cover.Ef56.jpg',
    '/d/_astro/draft-inline.Gh78.png',
    '/d/_astro/ec.0vx5m.js',
  ]);
});

test('removing a file orphans what only it referred to: repeats until nothing more goes', () => {
  const assets = ['/d/_astro/dormant.A.css', '/d/_astro/chart-bg.B.svg', '/d/_astro/font.C.woff2', '/d/_astro/lazy.D.js', '/d/_astro/chunk.E.js'];
  const sources = [
    { path: '/d/_astro/dormant.A.css', text: '.x{background:url(./chart-bg.B.svg)}' },
    { path: '/d/_astro/chart-bg.B.svg', text: '<svg/>' },
    { path: '/d/_astro/lazy.D.js', text: 'import("./chunk.E.js")' },
    { path: '/d/_astro/chunk.E.js', text: 'export {}' },
    { path: '/d/index.html', text: '<style>@font-face{src:url(/_astro/font.C.woff2)}</style>' },
  ];
  assert.deepEqual(unreferencedAssets(assets, sources).sort(), [
    '/d/_astro/chart-bg.B.svg',
    '/d/_astro/chunk.E.js',
    '/d/_astro/dormant.A.css',
    '/d/_astro/lazy.D.js',
  ]);
});

test('nothing to prune when every asset is referenced', () => {
  const sheets = ['/d/_astro/a.css'];
  assert.deepEqual(unreferencedAssets(sheets, [{ path: '/d/x.html', text: 'href="/_astro/a.css"' }]), []);
  assert.deepEqual(unreferencedAssets([], []), []);
});
