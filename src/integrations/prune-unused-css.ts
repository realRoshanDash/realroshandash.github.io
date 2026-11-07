/**
 * Astro bundles every page's stylesheets before getStaticPaths has run, so a route that renders no pages still
 * leaves its CSS in dist/_astro, linked from nowhere: the dormant /notes and /trades sections until something is
 * published, and the blog's post and tag routes while every post is a draft. This integration deletes each
 * stylesheet in the asset folder that no file in the build refers to, so a section that isn't published ships
 * nothing at all.
 */
import { readdir, readFile, rm } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/** Files that can link or import a stylesheet. */
const REFERRERS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.svg', '.webmanifest']);

/** Stylesheets (paths) whose file name appears in none of `sources`, other than in themselves. */
export function unreferencedStylesheets(stylesheets: readonly string[], sources: readonly { path: string; text: string }[]): string[] {
  return stylesheets.filter((sheet) => {
    const name = basename(sheet);
    return !sources.some((source) => source.path !== sheet && source.text.includes(name));
  });
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))),
  );
  return nested.flat();
}

export default function pruneUnusedCss(): AstroIntegration {
  let assets = '_astro';
  return {
    name: 'prune-unused-css',
    hooks: {
      'astro:config:done': ({ config }) => {
        assets = config.build.assets;
      },
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const files = await walk(root);
        const sources = await Promise.all(
          files.filter((file) => REFERRERS.has(extname(file))).map(async (path) => ({ path, text: await readFile(path, 'utf8') })),
        );
        const assetDir = join(root, assets);
        const stylesheets = files.filter((file) => file.startsWith(assetDir + sep) && extname(file) === '.css');
        const unused = unreferencedStylesheets(stylesheets, sources);
        await Promise.all(unused.map((file) => rm(file)));
        if (unused.length) logger.info(`Removed ${unused.length} unreferenced stylesheet(s): ${unused.map((file) => basename(file)).join(', ')}`);
      },
    },
  };
}
