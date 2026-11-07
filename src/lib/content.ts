/**
 * The only way pages fetch content. Applies the draft policy and newest-first order, and owns entry URLs,
 * tag grouping and feed items, so pages, feeds and the sitemap always agree.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import type { RSSFeedItem, RSSOptions } from '@astrojs/rss';
import { SITE, TRADE_DISCLAIMER } from '../data/site.ts';
import { formatDate } from './format.ts';
import { escapeHtml, excerpt, markdownToPlain, slugify } from './text.ts';
import { compareTrades, tradeSynopsis } from './trades.ts';

/** Drafts show in `astro dev` and in builds run with SHOW_DRAFTS=1 (design/QA previews), never otherwise. */
export const SHOW_DRAFTS: boolean = import.meta.env.DEV || process.env.SHOW_DRAFTS === '1';

export type Post = CollectionEntry<'blog'>;
export type Trade = CollectionEntry<'trades'>;
export type Note = CollectionEntry<'notes'>;
export type Section = 'blog' | 'trades' | 'notes';
type Entry = Post | Trade | Note;

const isVisible = (entry: { data: { draft: boolean } }) => SHOW_DRAFTS || !entry.data.draft;

/** Newest published first; ties broken by id so every build orders them the same way. */
const newestFirst = (a: Entry, b: Entry) =>
  b.data.published.getTime() - a.data.published.getTime() || a.id.localeCompare(b.id);

export async function getPosts(): Promise<Post[]> {
  return (await getCollection('blog', isVisible)).sort(newestFirst);
}

/**
 * Trade ideas, newest first. `{ sort: 'status' }` puts live ideas first — active, watching, closed, stopped,
 * invalidated — newest first within each status.
 */
export async function getTrades({ sort = 'newest' }: { sort?: 'newest' | 'status' } = {}): Promise<Trade[]> {
  const trades = (await getCollection('trades', isVisible)).sort(newestFirst);
  return sort === 'status' ? trades.sort((a, b) => compareTrades(a.data, b.data)) : trades;
}

export async function getNotes(): Promise<Note[]> {
  return (await getCollection('notes', isVisible)).sort(newestFirst);
}

const SECTION_PATHS: Record<Section, string> = { blog: '/blog/', trades: '/trades/', notes: '/notes/' };

/** Site-relative URL of an entry, e.g. /trades/nvda-breakout-retest-example/ (directory build format). */
export function entryPath(collection: Section, id: string): string {
  return `${SECTION_PATHS[collection]}${id}/`;
}

/** Absolute URL on the canonical origin, for feeds, canonical links and Open Graph tags. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE.url).href;
}

export interface TagSummary {
  /** Display spelling, taken from the newest entry that uses the tag. */
  tag: string;
  slug: string;
  count: number;
}

const unsluggable = new Set<string>();

/** An entry's tags as slug → spelling, one per slug. Tags with nothing URL-safe are skipped (warned once). */
function tagSlugs(tags: readonly string[]): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const tag of tags) {
    const slug = slugify(tag);
    if (slug) {
      if (!slugs.has(slug)) slugs.set(slug, tag);
    } else if (!unsluggable.has(tag)) {
      unsluggable.add(tag);
      console.warn(`[content] Tag "${tag}" has no URL-safe characters, so it gets no tag page.`);
    }
  }
  return slugs;
}

const SECTIONS = { blog: getPosts, trades: getTrades, notes: getNotes } as const;

/** A section's tags with entry counts, most used first. Spellings that share a slug ("AI", "ai") are merged. */
export async function getTags(collection: Section): Promise<TagSummary[]> {
  const entries: readonly Entry[] = await SECTIONS[collection]();
  const tags = new Map<string, TagSummary>();
  for (const { data } of entries) {
    for (const [slug, tag] of tagSlugs(data.tags)) {
      const summary = tags.get(slug);
      if (summary) summary.count += 1;
      else tags.set(slug, { tag, slug, count: 1 });
    }
  }
  return [...tags.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Whether an entry carries the tag with this slug. */
export function hasTag(entry: { data: { tags: readonly string[] } }, slug: string): boolean {
  return entry.data.tags.some((tag) => slugify(tag) === slug);
}

export async function getPostsByTag(slug: string): Promise<Post[]> {
  return (await getPosts()).filter((post) => hasTag(post, slug));
}

/** Neighbours of `id` in a newest-first list: `prev` is the older entry, `next` the newer one. */
export function adjacent<T extends { id: string }>(
  entries: readonly T[],
  id: string,
): { prev: T | undefined; next: T | undefined } {
  const i = entries.findIndex((entry) => entry.id === id);
  if (i === -1) return { prev: undefined, next: undefined };
  return { prev: entries[i + 1], next: i > 0 ? entries[i - 1] : undefined };
}

/** Up to `n` other entries sharing the most tags with `entry`, newest first on ties; [] when none share a tag. */
export function related<T extends { id: string; data: { tags: readonly string[]; published: Date } }>(
  entry: T,
  entries: readonly T[],
  n = 3,
): T[] {
  const mine = new Set(tagSlugs(entry.data.tags).keys());
  return entries
    .filter((other) => other.id !== entry.id)
    .map((other) => ({ other, shared: [...tagSlugs(other.data.tags).keys()].filter((slug) => mine.has(slug)).length }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || b.other.data.published.getTime() - a.other.data.published.getTime())
    .slice(0, n)
    .map(({ other }) => other);
}

/** A note's title; an untitled note falls back to its opening words, then its image alt text, then its date. */
export function noteTitle(note: Note, maxChars = 80): string {
  return (
    note.data.title?.trim() ||
    excerpt(note.body ?? '', maxChars) ||
    note.data.imageAlt?.trim() ||
    `Note, ${formatDate(note.data.published)}`
  );
}

/** Items per feed. Readers only need recent items, and it keeps every feed small. */
export const FEED_LIMIT = 50;

export type FeedItem = RSSFeedItem & { link: string; pubDate: Date };

/** Channel options shared by every feed: the section's page as channel link, language and an Atom self link. */
export function feedChannel(
  feedPath: string,
  sectionPath = '/',
): Pick<RSSOptions, 'site' | 'xmlns' | 'customData' | 'trailingSlash'> {
  return {
    site: absoluteUrl(sectionPath),
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData:
      `<language>${SITE.locale.toLowerCase()}</language>` +
      `<atom:link href="${absoluteUrl(feedPath)}" rel="self" type="application/rss+xml"/>`,
    trailingSlash: true,
  };
}

/** Newest first, for merging feed items from several sections. */
export const byPubDate = (a: FeedItem, b: FeedItem) => b.pubDate.getTime() - a.pubDate.getTime();

const asSentence = (text: string) => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export function postFeedItem(post: Post): FeedItem {
  return {
    title: post.data.title,
    link: absoluteUrl(entryPath('blog', post.id)),
    pubDate: post.data.published,
    description: post.data.description,
    categories: post.data.tags,
  };
}

/**
 * The description carries the levels with R, the status or result, and the disclaimer, which a feed reader
 * would otherwise never show.
 */
export function tradeFeedItem(trade: Trade): FeedItem {
  return {
    title: trade.data.title,
    link: absoluteUrl(entryPath('trades', trade.id)),
    pubDate: trade.data.published,
    description: `${asSentence(trade.data.summary)} ${tradeSynopsis(trade.data)} ${TRADE_DISCLAIMER}`,
    categories: trade.data.tags,
  };
}

/** Notes are short, so the feed carries their full text: plain text, one <p> per paragraph, then the link. */
export function noteFeedItem(note: Note): FeedItem {
  const body = note.body ?? '';
  const html = markdownToPlain(body)
    .split('\n\n')
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);
  const { link } = note.data;
  if (link) html.push(`<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`);
  return {
    title: noteTitle(note),
    link: absoluteUrl(entryPath('notes', note.id)),
    pubDate: note.data.published,
    description: excerpt(body, 280) || undefined,
    content: html.join('') || undefined,
    categories: note.data.tags,
  };
}
