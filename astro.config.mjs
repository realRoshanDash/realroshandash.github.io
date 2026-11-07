// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import { satteri } from '@astrojs/markdown-satteri';
import satteriCallouts from 'satteri-callouts';
import { SITE } from './src/data/site.ts';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: SITE.url,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  markdown: {
    // Sätteri is Astro 7's native Markdown pipeline; callouts use Obsidian/GitHub syntax: > [!NOTE]
    processor: satteri({ hastPlugins: [satteriCallouts()] }),
  },
  integrations: [
    // Expressive Code must come before MDX.
    expressiveCode({ themes: ['github-dark-default', 'github-light-default'] }),
    mdx(),
    sitemap({ filter: (page) => !/\/(admin|404)(\/|$)/.test(new URL(page).pathname) }),
  ],
});
