#!/usr/bin/env node
// @ts-check
/**
 * Scaffold a draft entry as a page bundle: src/content/<collection>/<slug>/index.md, so images
 * can sit next to it (cover: photo.webp). The front matter matches src/content.config.ts.
 *
 *   npm run new:post  -- "Title of the post"
 *   npm run new:trade -- NVDA long
 *   npm run new:note  -- "Optional title"       (same as: node scripts/new-entry.mjs note …)
 *
 * Dates use the site timezone (SITE.timezone, Singapore). An existing slug gets -2, -3, …
 * Every entry starts as `draft: true`, and placeholders that must be replaced say TODO.
 * Node built-ins only.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/data/site.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'src', 'content');

/** Same rule as the `ticker` field in src/content.config.ts (after trim + upper-case). */
const TICKER_RE = /^[A-Z0-9.\-^=!]{1,15}$/;

const USAGE = `Usage:
  npm run new:post  -- "Title"            new blog post
  npm run new:trade -- TICKER long|short  new trade idea, e.g. NVDA long
  npm run new:note  -- ["Title"]          new note (title optional)`;

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

/**
 * The current wall-clock time in `timeZone`.
 * @param {string} timeZone
 * @returns {{ date: string, hhmm: string, iso: string }} date "2026-11-07", hhmm "1532",
 *   iso "2026-11-07T15:32:09+08:00"
 */
function now(timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return { date, hhmm: `${parts.hour}${parts.minute}`, iso: `${date}T${parts.hour}:${parts.minute}:${parts.second}${offset}` };
}

/**
 * URL-safe ASCII slug, at most `max` characters, cut at a word boundary where possible.
 * @param {string} text
 */
function slugify(text, max = 64) {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip accents: café → cafe
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  return (cut.lastIndexOf('-') > max / 2 ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/, '');
}

/**
 * Create <collection>/<slug>/index.md, adding -2, -3, … while the slug is taken. A slug is
 * taken by a folder or by a single-file entry (<slug>.md / .mdx): either would give Astro a
 * duplicate entry id.
 * @param {string} collection
 * @param {string} baseSlug
 * @param {string} contents
 */
function writeBundle(collection, baseSlug, contents) {
  const dir = join(CONTENT, collection);
  mkdirSync(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const slug = n === 1 ? baseSlug : `${baseSlug}-${n}`;
    if (['', '.md', '.mdx'].some((ext) => existsSync(join(dir, slug + ext)))) continue;
    const file = join(dir, slug, 'index.md');
    mkdirSync(dirname(file));
    writeFileSync(file, contents, { flag: 'wx' }); // never overwrite
    return relative(ROOT, file);
  }
}

/** Double-quoted YAML string. JSON strings are valid YAML, and this escapes quotes/specials. */
const q = (/** @type {string} */ s) => JSON.stringify(s);

const [kind, ...args] = process.argv.slice(2);
if (kind === '-h' || kind === '--help') {
  console.log(USAGE);
  process.exit(0);
}
const today = now(SITE.timezone);
/** @type {string} */
let created;

switch (kind) {
  case 'post': {
    const title = args.join(' ').trim();
    if (!title) fail('A post needs a title.');
    if (title.length > 140) fail(`The title is ${title.length} characters; the schema allows 140.`);
    created = writeBundle(
      'blog',
      slugify(title) || `post-${today.date}`,
      `---
title: ${q(title)}
description: "TODO: one or two sentences for lists, feeds and link previews (max 300 characters)."
published: ${today.date}
# updated: ${today.date}
tags: []
# cover: cover.webp           # an image in this folder
# coverAlt: "What the cover shows"
featured: false
draft: true
---

TODO: write the post.
`,
    );
    break;
  }

  case 'trade': {
    if (args.length !== 2) fail('A trade idea needs a ticker and a direction, e.g. NVDA long.');
    const ticker = args[0].trim().toUpperCase();
    const direction = args[1].trim().toLowerCase();
    if (!TICKER_RE.test(ticker)) fail(`"${args[0]}" isn't a valid ticker: 1–15 letters, digits or . - ^ = !`);
    if (direction !== 'long' && direction !== 'short') fail(`Direction must be "long" or "short", not "${args[1]}".`);
    const long = direction === 'long';
    // Placeholder levels that pass the schema's checks (stop on the losing side of the entry,
    // targets on the winning side), so the draft builds. Replace them before publishing.
    const levels = long ? { stop: 95, targets: '[110, 120]' } : { stop: 105, targets: '[90, 80]' };
    created = writeBundle(
      'trades',
      `${today.date}-${slugify(ticker) || 'ticker'}-${direction}`,
      `---
title: ${q(`${ticker} ${direction} idea`)}
summary: "TODO: the thesis in one or two sentences (max 300 characters)."
ticker: ${q(ticker)}
exchange: NASDAQ             # NASDAQ | NYSE | AMEX | CBOE | OTC | CRYPTO | OTHER
# tvSymbol: "NYSE:BRK.B"     # only if EXCHANGE:TICKER isn't the TradingView symbol
direction: ${direction}
setup: Other                 # Breakout | Episodic pivot | Pullback | Base breakout | Flag | Gap & go | Parabolic short | Range | Earnings | Reversal | Other
timeframe: swing             # intraday | swing | position
status: watching             # watching → active → closed | stopped, or invalidated
published: ${today.date}
# TODO: placeholder levels, replace before publishing (${long ? 'long: stop < entry < targets' : 'short: targets < entry < stop'}).
entry: 100
stop: ${levels.stop}
targets: ${levels.targets}
# triggered: ${today.date}      # when the entry filled (watching → active)
# exit: 0                    # average exit price, required once closed or stopped
# closed: ${today.date}
# conviction: 3              # 1 (low) to 5 (high)
tags: []
# chart: chart.png           # an image in this folder
# chartAlt: "What the chart shows"
updates: []
draft: true
---

## Thesis

TODO

## Plan

TODO: entry trigger, where the stop goes and why, how you'll take profits.

## Risks

TODO
`,
    );
    break;
  }

  case 'note': {
    const title = args.join(' ').trim();
    if (title.length > 140) fail(`The title is ${title.length} characters; the schema allows 140.`);
    created = writeBundle(
      'notes',
      `${today.date}-${slugify(title, 48) || today.hhmm}`,
      `---
${title ? `title: ${q(title)}` : '# title: "Optional"'}
published: ${today.iso}
tags: []
# image: photo.webp           # an image in this folder
# imageAlt: "What the photo shows"
# link: "https://example.com/the-page-this-note-is-about"
draft: true
---

TODO: write the note.
`,
    );
    break;
  }

  default:
    fail(kind ? `Unknown entry type "${kind}".` : 'Say what to create: post, trade or note.');
}

console.log(`Created ${created} (draft)
Next: edit it, put any images in the same folder, and preview it with npm run dev (drafts always show in dev).
To publish: set draft: false, then commit and push to master.`);
