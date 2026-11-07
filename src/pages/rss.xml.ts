import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE } from '../data/site.ts';
import { FEED_LIMIT, feedChannel, getPosts, postFeedItem } from '../lib/content.ts';

/**
 * The site feed (the footer's and the palette's RSS, design spec §8.7): posts only, newest first. The dormant
 * sections keep their own feeds (/notes/rss.xml, /trades/rss.xml), built only once they publish, so a trade idea
 * never reaches a public channel outside its section.
 */
export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/rss.xml'),
    title: SITE.title,
    description: SITE.description,
    items: (await getPosts()).slice(0, FEED_LIMIT).map(postFeedItem),
  });
