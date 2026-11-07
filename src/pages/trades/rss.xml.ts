import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE, TRADE_DISCLAIMER } from '../../data/site.ts';
import { FEED_LIMIT, feedChannel, getTrades, tradeFeedItem } from '../../lib/content.ts';

export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/trades/rss.xml', '/trades/'),
    title: `Trade Ideas · ${SITE.title}`,
    description: `Trade ideas by ${SITE.name}: the setup, entry, stop and targets in R, and how each one played out. ${TRADE_DISCLAIMER}`,
    items: (await getTrades()).slice(0, FEED_LIMIT).map(tradeFeedItem),
  });
