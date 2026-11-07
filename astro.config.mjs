// @ts-check
import { readdirSync } from 'node:fs';
import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import { satteri } from '@astrojs/markdown-satteri';
import satteriCallouts from 'satteri-callouts';
import { SITE } from './src/data/site.ts';
import pruneUnusedCss from './src/integrations/prune-unused-css.ts';
import { normalizeHeadings } from './src/lib/markdown/normalize-headings.ts';
import { wrapTables } from './src/lib/markdown/wrap-tables.ts';

// satteri-callouts is typed against an older satteri plugin interface; it is runtime-compatible.
// GitHub's five types (NOTE, TIP, IMPORTANT, WARNING, CAUTION); the marks are drawn in CSS (src/styles/prose.css).
/** @type {any} */
const callouts = satteriCallouts({ theme: 'github', showIndicator: false });

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

// Link prefetching only pays off once there is a second HTML page to move to. Until then every internal link is a
// same-page anchor, so the prefetch script (≈1.1 KB gz and a body-wide MutationObserver) would be dead weight.
const HTML_PAGES = readdirSync(new URL('./src/pages/', import.meta.url), { recursive: true })
  .map(String)
  .filter((file) => /\.(astro|mdx?|html)$/.test(file) && !/(^|\/)_/.test(file));

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: SITE.url,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  prefetch: HTML_PAGES.length > 1 ? { prefetchAll: true, defaultStrategy: 'hover' } : false,
  // Self-hosted from pinned Fontsource npm packages: no network at build time, metric-matched fallbacks, no layout
  // shift. Inter is the only family people read: one variable file carries the weight axis (100–900) and the
  // optical-size axis (opsz 14–32). Italic downloads only where italic text renders. JetBrains Mono is reserved
  // for what machines say (code, routes, hashes).
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Inter',
      cssVariable: '--font-sans',
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      options: {
        variants: [
          { weight: '100 900', style: 'normal', display: 'swap', unicodeRange: [LATIN], src: ['@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2'] },
          { weight: '100 900', style: 'italic', display: 'swap', unicodeRange: [LATIN], src: ['@fontsource-variable/inter/files/inter-latin-wght-italic.woff2'] },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      options: {
        variants: [
          { weight: 400, style: 'normal', display: 'swap', unicodeRange: [LATIN], src: ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2'] },
        ],
      },
    },
  ],
  markdown: {
    // Sätteri is Astro 7's native Markdown pipeline; callouts use GitHub syntax: > [!NOTE]. A post's top heading
    // level becomes h2 (the page title is the h1); tables scroll inside a focusable region; footnote back-links
    // use ↑, which the shipped Inter subset has (↩ would fall back).
    processor: satteri({
      hastPlugins: [normalizeHeadings, callouts, wrapTables],
      features: { gfm: { footnotes: { backContent: '↑' } } },
    }),
  },
  integrations: [
    // Expressive Code must come before MDX. Its options (theme, plugins, style overrides) are in ec.config.mjs.
    expressiveCode(),
    mdx(),
    sitemap({ filter: (page) => !/\/(admin|404)(\/|$)/.test(new URL(page).pathname) }),
    pruneUnusedCss(), // unpublished sections (no pages) leave no stylesheets behind
  ],
});
