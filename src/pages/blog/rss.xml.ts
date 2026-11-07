import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { FEED_LIMIT, feedChannel, getPosts, postFeedItem } from '../../lib/content.ts';
import { WRITING_DESCRIPTION, WRITING_FEED_TITLE } from '../../components/writing/posts.ts';

/**
 * The same channel as /rss.xml, kept for readers subscribed before the two were merged (Nov 2026). Nothing links
 * or advertises it: every page points at /rss.xml (WRITING_FEED).
 */
export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/blog/rss.xml', '/blog/'),
    title: WRITING_FEED_TITLE,
    description: WRITING_DESCRIPTION,
    items: (await getPosts()).slice(0, FEED_LIMIT).map(postFeedItem),
  });
