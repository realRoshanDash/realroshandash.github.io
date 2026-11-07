import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE } from '../data/site.ts';
import {
  byPubDate,
  FEED_LIMIT,
  feedChannel,
  getNotes,
  getPosts,
  getTrades,
  noteFeedItem,
  postFeedItem,
  tradeFeedItem,
} from '../lib/content.ts';

/** Everything: writing, trade ideas and notes, newest first. */
export const GET: APIRoute = async () => {
  const [posts, trades, notes] = await Promise.all([getPosts(), getTrades(), getNotes()]);
  const items = [...posts.map(postFeedItem), ...trades.map(tradeFeedItem), ...notes.map(noteFeedItem)]
    .sort(byPubDate)
    .slice(0, FEED_LIMIT);
  return rss({ ...feedChannel('/rss.xml'), title: SITE.title, description: SITE.description, items });
};
