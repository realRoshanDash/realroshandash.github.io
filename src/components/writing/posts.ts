/**
 * Writing: every visible post as a display item, computed once per build. Content always comes from
 * src/lib/content.ts (draft policy, ordering, URLs); the display rules are in display.ts (pure, unit-tested).
 */
import type { CollectionEntry } from 'astro:content';
import { entryPath, getPosts } from '@/lib/content';
import { formatDateISO } from '@/lib/format';
import {
  ARCHIVE_BEFORE_YEAR,
  formatNo,
  keepDashes,
  minutesToRead,
  postNumbers,
  tagRefs,
  vtName,
  type TagRef,
} from './display';

export { byYear, jsonLd, longestWord, NO_VALUE, tagHref, tagLabel, type TagRef } from './display';

type Post = CollectionEntry<'blog'>;

export interface PostItem {
  post: Post;
  id: string;
  /** Title and description, typeset for display (no line starts with a dash) */
  title: string;
  description: string;
  href: string;
  /** Publication number; undefined for a draft */
  no: number | undefined;
  /** "004", or the en dash for a draft */
  noLabel: string;
  minutes: number;
  /** Published, YYYY-MM-DD on the Singapore calendar */
  iso: string;
  /** Updated, YYYY-MM-DD, when set and later than published */
  updatedIso: string | undefined;
  year: string;
  tags: TagRef[];
  draft: boolean;
  /** Restored from the previous version of the site (published before this one existed) */
  archived: boolean;
  /** view-transition-name shared by the list title and the article <h1> */
  vt: string;
}

/** The writing feed (posts only). The site-wide feed is /rss.xml. */
export const WRITING_FEED = '/blog/rss.xml';

/** Copy deck §7.3 / §7.4 */
export const WRITING_DESCRIPTION =
  'Long-form notes on backend systems, distributed systems, databases and building with AI agents.';

function toItem(post: Post, numbers: Map<string, number>): PostItem {
  const no = numbers.get(post.id);
  const iso = formatDateISO(post.data.published);
  const updated = post.data.updated ? formatDateISO(post.data.updated) : undefined;
  const year = iso.slice(0, 4);
  return {
    post,
    id: post.id,
    title: keepDashes(post.data.title),
    description: keepDashes(post.data.description),
    href: entryPath('blog', post.id),
    no,
    noLabel: formatNo(no),
    minutes: minutesToRead(post.body),
    iso,
    updatedIso: updated && updated > iso ? updated : undefined,
    year,
    tags: tagRefs(post.data.tags),
    draft: post.data.draft,
    archived: Number(year) < ARCHIVE_BEFORE_YEAR,
    vt: vtName(post.id),
  };
}

/**
 * Every visible post (published; drafts too in dev and SHOW_DRAFTS=1 previews) as display items, newest first.
 * Numbers are computed over all visible posts, so a post keeps its number on every page that lists it.
 */
export async function getPostItems(): Promise<PostItem[]> {
  const posts = await getPosts();
  const numbers = postNumbers(posts);
  return posts.map((post) => toItem(post, numbers));
}
