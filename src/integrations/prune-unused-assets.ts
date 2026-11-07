/**
 * Deletes every file in the build's asset folder (dist/_astro) that nothing in the build refers to.
 *
 * Astro bundles and copies assets before getStaticPaths has run, so a route that renders no pages still leaves
 * its files behind, linked from nowhere: the dormant /notes and /trades sections' stylesheets until something is
 * published; the blog's post and tag routes' CSS and Expressive Code's copy-button script while every post is a
 * draft; and a draft's photos, the cover copied byte for byte from src/content (EXIF and GPS included) because
 * the schema's image() imports it. None of that is reachable, but it would all be deployed and served. A section
 * that isn't published ships nothing at all.
 *
 * A file counts as referenced when its name appears in any HTML, CSS, JS, JSON, XML, SVG, TXT or web manifest file
 * of the build other than itself (links, imports, preload lists, srcsets, url()s, worker URLs). Removing a file can
 * orphan what only it referred to (a stylesheet's fonts or images, a chunk's chunks), so the pass repeats until
 * nothing more goes.
 */
import { readdir, readFile, rm } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/** Files that can refer to another file. */
const REFERRERS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.svg', '.txt', '.webmanifest']);

export interface Source {
  path: string;
  text: string;
}

/**
 * The assets (paths) whose file name appears in none of `sources` but themselves, repeated to a fixed point: an
 * asset that only removed files referred to goes too. `sources` should include the assets that are text files.
 */
export function unreferencedAssets(assets: readonly string[], sources: readonly Source[]): string[] {
  const removed: string[] = [];
  let left = [...assets];
  let live = [...sources];
  for (;;) {
    const orphans = left.filter((asset) => {
      const name = basename(asset);
      return !live.some((source) => source.path !== asset && source.text.includes(name));
    });
    if (orphans.length === 0) return removed;
    removed.push(...orphans);
    const gone = new Set(orphans);
    left = left.filter((asset) => !gone.has(asset));
    live = live.filter((source) => !gone.has(source.path));
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)]))),
  );
  return nested.flat();
}

export default function pruneUnusedAssets(): AstroIntegration {
  let assets = '_astro';
  return {
    name: 'prune-unused-assets',
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
        const unused = unreferencedAssets(files.filter((file) => file.startsWith(assetDir + sep)), sources);
        await Promise.all(unused.map((file) => rm(file)));
        if (unused.length) {
          logger.info(`Removed ${unused.length} unreferenced asset(s): ${unused.map((file) => relative(assetDir, file)).join(', ')}`);
        }
      },
    },
  };
}
