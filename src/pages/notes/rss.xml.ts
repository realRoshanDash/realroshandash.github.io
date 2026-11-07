import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE } from '../../data/site.ts';
import { FEED_LIMIT, feedChannel, getNotes, noteFeedItem } from '../../lib/content.ts';

export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/notes/rss.xml', '/notes/'),
    title: `Notes · ${SITE.title}`,
    description: `Short-form notes by ${SITE.name}: markets, links and things learned.`,
    items: (await getNotes()).slice(0, FEED_LIMIT).map(noteFeedItem),
  });
