import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE } from '../../data/site.ts';
import { FEED_LIMIT, feedChannel, getPosts, postFeedItem } from '../../lib/content.ts';
import { WRITING_DESCRIPTION } from '../../components/writing/posts.ts';

/** The writing feed: posts only (copy deck §7.4). The site-wide feed is /rss.xml. */
export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/blog/rss.xml', '/blog/'),
    title: `${SITE.name} — Writing`,
    description: WRITING_DESCRIPTION,
    items: (await getPosts()).slice(0, FEED_LIMIT).map(postFeedItem),
  });
