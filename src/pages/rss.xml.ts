import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { WRITING_DESCRIPTION, WRITING_FEED_TITLE } from '../components/writing/posts.ts';
import { FEED_LIMIT, feedChannel, getPosts, postFeedItem } from '../lib/content.ts';

/**
 * The feed (design spec §8.7, copy deck §7.4): "Roshan Dash — Writing", posts only, newest first. Every page
 * advertises it and every RSS link points here. The dormant sections keep their own feeds (/notes/rss.xml,
 * /trades/rss.xml), built only once they publish, so a trade idea never reaches a public channel outside its section.
 */
export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/rss.xml', '/blog/'),
    title: WRITING_FEED_TITLE,
    description: WRITING_DESCRIPTION,
    items: (await getPosts()).slice(0, FEED_LIMIT).map(postFeedItem),
  });
