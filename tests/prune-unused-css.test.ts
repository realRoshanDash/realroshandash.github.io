/**
 * The build drops stylesheets nothing links to (src/integrations/prune-unused-css.ts), so routes that render no
 * pages — the dormant /notes and /trades sections — leave no CSS in dist.
 * Run: node --test tests/prune-unused-css.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unreferencedStylesheets } from '../src/integrations/prune-unused-css.ts';

test('keeps stylesheets that a page links, CSS imports or a script preloads; drops the rest', () => {
  const sheets = ['/d/_astro/index.A1.css', '/d/_astro/_..B2.css', '/d/_astro/shared.C3.css', '/d/_astro/lazy.D4.css'];
  const sources = [
    { path: '/d/index.html', text: '<link rel="stylesheet" href="/_astro/index.A1.css">' },
    { path: '/d/_astro/index.A1.css', text: '@import "./shared.C3.css";' },
    { path: '/d/_astro/page.js', text: '__vitePreload(() => import("./x.js"), ["_astro/lazy.D4.css"])' },
    // A file mentioning its own name doesn't keep itself alive.
    { path: '/d/_astro/_..B2.css', text: '.tcard{} /*# sourceMappingURL=_..B2.css.map */' },
  ];
  assert.deepEqual(unreferencedStylesheets(sheets, sources), ['/d/_astro/_..B2.css']);
});

test('nothing to prune when every stylesheet is linked', () => {
  const sheets = ['/d/_astro/a.css'];
  assert.deepEqual(unreferencedStylesheets(sheets, [{ path: '/d/x.html', text: 'href="/_astro/a.css"' }]), []);
  assert.deepEqual(unreferencedStylesheets([], []), []);
});
