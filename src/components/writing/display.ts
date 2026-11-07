/**
 * How a post displays: numbers, reading time, tag labels, view-transition names, punctuation. Pure (no Astro
 * imports, relative .ts imports), so `node --test` covers it (tests/writing.test.ts). posts.ts builds on it.
 *
 * - Numbers: "No. 001" is the oldest *published* post. Drafts are never numbered, so a draft preview never shifts
 *   the numbers of published posts, and a draft shows the en dash, "no value" (spec §4.12, §4.19).
 * - Reading time: ceil(words / 230), at least 1, shown as "9 min".
 */
import { readingTime, slugify } from '../../lib/text.ts';

const WORDS_PER_MINUTE = 230;

/** "In a table, an en dash means “no value”." (spec §4.19) */
export const NO_VALUE = '–';

/**
 * Posts published before this version of the site are restored from the previous one (the 2021 archive): they
 * carry the FROM THE ARCHIVE badge in lists and the archive note on the page (copy deck §7.4).
 */
export const ARCHIVE_BEFORE_YEAR = 2025;

export interface TagRef {
  /** Display spelling, e.g. "Distributed systems" */
  label: string;
  slug: string;
  /** The tag's page, /blog/tags/<slug>/ */
  href: string;
}

/** Reading time in whole minutes: ceil(words / 230), at least 1 (spec §4.12). */
export function minutesToRead(body: string | undefined): number {
  return Math.max(1, Math.ceil(readingTime(body ?? '').words / WORDS_PER_MINUTE));
}

/**
 * view-transition-name for a post (spec §3.6): a valid CSS ident, unique per post. The list title and the article
 * <h1> carry the same name, so the title morphs between the two pages.
 */
export function vtName(id: string): string {
  return `post-${id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^(\d)/, 'p-$1')}`;
}

export const tagHref = (slug: string): string => `/blog/tags/${slug}/`;

// Spelled as acronyms when a tag is written all-lowercase ("ai-agents" → "AI agents").
const ACRONYMS = new Set([
  'ai', 'api', 'apis', 'aws', 'cdn', 'ci', 'cd', 'css', 'db', 'dns', 'gc', 'gcp', 'grpc', 'html', 'http', 'io', 'jdk',
  'js', 'json', 'jvm', 'llm', 'llms', 'ml', 'orm', 'os', 'rpc', 'sdk', 'sql', 'tcp', 'ts', 'ui', 'ux', 'vm', 'xml', 'yaml',
]);

/**
 * How a tag reads on the page. A tag written with capitals is shown as written ("PostgreSQL"); an all-lowercase,
 * slug-style tag gets sentence case, spaces for hyphens and common acronyms ("distributed-systems" →
 * "Distributed systems", "ai-agents" → "AI agents").
 */
export function tagLabel(tag: string): string {
  const text = tag.trim();
  if (/[A-Z]/.test(text)) return text;
  return text
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word, i) => (ACRONYMS.has(word) ? word.toUpperCase() : i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** A post's tags with their pages, one per slug. A tag with nothing URL-safe in it gets no page, so no link. */
export function tagRefs(tags: readonly string[]): TagRef[] {
  const seen = new Set<string>();
  const refs: TagRef[] = [];
  for (const tag of tags) {
    const slug = slugify(tag);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    refs.push({ label: tagLabel(tag), slug, href: tagHref(slug) });
  }
  return refs;
}

/** Publication numbers by id: published entries only, oldest first, ties broken by id (stable across builds). */
export function postNumbers(entries: readonly { id: string; data: { draft: boolean; published: Date } }[]): Map<string, number> {
  const published = entries
    .filter((entry) => !entry.data.draft)
    .sort((a, b) => a.data.published.getTime() - b.data.published.getTime() || a.id.localeCompare(b.id));
  return new Map(published.map((entry, i) => [entry.id, i + 1]));
}

/** "004", or the en dash for an unnumbered draft. */
export function formatNo(no: number | undefined): string {
  return no === undefined ? NO_VALUE : String(no).padStart(3, '0');
}

/** Copy deck punctuation rule (§7): a spaced em dash never starts a line, so the space before it doesn't break. */
export function keepDashes(text: string): string {
  return text.replace(/ (—)/g, '\u00a0$1');
}

/** Groups by year, newest year first; the input order is kept inside each year. */
export function byYear<T extends { year: string }>(items: readonly T[]): { year: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.year);
    if (group) group.push(item);
    else groups.set(item.year, [item]);
  }
  return [...groups].map(([year, list]) => ({ year, items: list })).sort((a, b) => b.year.localeCompare(a.year));
}

/** Longest word, in characters: fits a display title to its column in pure CSS (no runtime measuring). */
export function longestWord(text: string): number {
  return Math.max(1, ...text.split(/\s+/).map((word) => [...word].length));
}

/** JSON for a <script type="application/ld+json">, safe to inline: "<" can never close the script element. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
