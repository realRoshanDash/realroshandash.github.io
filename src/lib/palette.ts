/**
 * ⌘K command palette (design spec §4.5): the data the page ships to it, and the pure parts of searching it —
 * matching and scoring labels, highlight ranges, display routes and copy. No DOM and no Astro imports, so the
 * build, the browser and `node --test` share it.
 */

export type PaletteGroup = 'pages' | 'writing' | 'actions' | 'elsewhere';

/** Display order with an empty query (and the tie-break order while searching). */
export const GROUP_ORDER: readonly PaletteGroup[] = ['pages', 'writing', 'actions', 'elsewhere'];
export const GROUP_LABELS: Record<PaletteGroup, string> = {
  pages: 'Pages',
  writing: 'Writing',
  actions: 'Actions',
  elsewhere: 'Elsewhere',
};

export interface PalettePage {
  label: string;
  url: string;
  description: string;
  keywords?: string[];
}

export interface PalettePost {
  label: string;
  url: string;
  description: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  minutes: number;
  tags: string[];
  draft?: boolean;
}

/** Everything the palette needs from the build, serialised into the dialog shell. */
export interface PaletteData {
  pages: PalettePage[];
  /** Newest first. The empty state shows the first three. */
  posts: PalettePost[];
  elsewhere: PalettePage[];
  /** Where "Verify and reveal email" goes on pages without a gate. */
  verify: string;
}

/* ---------------------------------------------------------------- matching */

export type Range = readonly [start: number, end: number];

export interface Match {
  score: number;
  /** Ranges of the label to highlight, sorted and merged. */
  ranges: Range[];
}

/** Lower-case, accents removed, with a map from each folded index back to the original string. */
function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const plain = char.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < plain.length; k++) map.push(index);
    folded += plain;
    index += char.length;
  }
  map.push(index);
  return { folded, map };
}

const isWordStart = (text: string, i: number) => i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);

/** Best occurrence of `term` in `text`: [score, index] or null. Prefix > word start > anywhere (2+ chars). */
function locate(text: string, term: string): [number, number] | null {
  if (text.startsWith(term)) return [100, 0];
  let anywhere = -1;
  for (let i = text.indexOf(term, 1); i !== -1; i = text.indexOf(term, i + 1)) {
    if (isWordStart(text, i)) return [80, i];
    if (anywhere === -1) anywhere = i;
  }
  return anywhere !== -1 && term.length >= 2 ? [50, anywhere] : null;
}

/**
 * Score an entry against a query. Every word of the query must match the label (highlighted) or, more weakly, a
 * keyword. Returns null when any word is missing. Scores: label prefix 100, word start 80, inside a word 50;
 * keyword prefix 40, inside a keyword 20; plus 20 when the whole query starts a word of the label.
 */
export function matchEntry(query: string, label: string, keywords: readonly string[] = []): Match | null {
  const terms = fold(query).folded.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  const { folded, map } = fold(label);
  const keys = keywords.map((keyword) => fold(keyword).folded);
  const ranges: Range[] = [];
  let total = 0;
  for (const term of terms) {
    const found = locate(folded, term);
    if (found) {
      total += found[0];
      ranges.push([map[found[1]], map[found[1] + term.length]]);
      continue;
    }
    let best = 0;
    for (const key of keys) {
      if (key.startsWith(term) || key.split(/\s+/).some((word) => word.startsWith(term))) best = Math.max(best, 40);
      else if (term.length >= 3 && key.includes(term)) best = Math.max(best, 20);
    }
    if (!best) return null;
    total += best;
  }
  const phrase = terms.join(' ');
  const whole = terms.length > 1 ? locate(folded, phrase) : null;
  const score = Math.round(total / terms.length) + (whole && whole[0] >= 80 ? 20 : 0);
  return { score, ranges: mergeRanges(ranges) };
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Split text into plain and marked runs for the given ranges. */
export function highlight(text: string, ranges: readonly Range[]): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [a, b] of mergeRanges(ranges)) {
    const start = Math.max(a, at);
    const end = Math.min(b, text.length);
    if (start >= end) continue;
    if (start > at) out.push({ text: text.slice(at, start), mark: false });
    out.push({ text: text.slice(start, end), mark: true });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out;
}

/* ---------------------------------------------------------------- copy */

const count = new Intl.NumberFormat('en-SG');

/** "1 result" · "5 results · 12 ms" (copy deck §7.9). */
export function resultCount(n: number, ms?: number): string {
  const results = `${count.format(n)} ${n === 1 ? 'result' : 'results'}`;
  return ms === undefined ? results : `${results} · ${Math.max(1, Math.round(ms))} ms`;
}

/**
 * How a URL reads in the palette's route column: site paths without the trailing slash ("/blog", "/#writing",
 * "/"), other origins without the scheme ("github.com/roshandash411").
 */
export function displayRoute(url: string, origin = 'https://roshandash.com'): string {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return url;
  }
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
  if (parsed.origin !== new URL(origin).origin) return `${parsed.host.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  return `${path}${parsed.hash}`;
}

/** ⌘ vs Ctrl in key hints. Chromium's userAgentData says "macOS"; navigator.platform says "MacIntel". */
export const isApplePlatform = (platform: string): boolean => /mac|iphone|ipad|ipod/i.test(platform);
