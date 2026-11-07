// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
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
  // Self-hosted at build time with metric-matched fallbacks (no layout shift, no third-party requests).
  fonts: [
    { provider: fontProviders.fontsource(), name: 'Inter Tight', cssVariable: '--font-sans', weights: ['300 900'], styles: ['normal'], subsets: ['latin'], fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'] },
    { provider: fontProviders.fontsource(), name: 'Instrument Serif', cssVariable: '--font-serif', weights: [400], styles: ['normal', 'italic'], subsets: ['latin'], fallbacks: ['ui-serif', 'Georgia', 'serif'] },
    { provider: fontProviders.fontsource(), name: 'JetBrains Mono', cssVariable: '--font-mono', weights: ['400 600'], styles: ['normal'], subsets: ['latin'], fallbacks: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
  ],
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
