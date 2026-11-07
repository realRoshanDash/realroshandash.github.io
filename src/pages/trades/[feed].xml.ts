import rss from '@astrojs/rss';
import type { APIRoute, GetStaticPaths } from 'astro';
import { SITE, TRADE_DISCLAIMER } from '../../data/site.ts';
import { FEED_LIMIT, feedChannel, getTrades, tradeFeedItem } from '../../lib/content.ts';

/** /trades/rss.xml exists only once a trade idea is published (the section is hidden until then). */
export const getStaticPaths = (async () => ((await getTrades()).length ? [{ params: { feed: 'rss' } }] : [])) satisfies GetStaticPaths;

export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/trades/rss.xml', '/trades/'),
    title: `Trade Ideas · ${SITE.title}`,
    description: `Trade ideas by ${SITE.name}: the setup, entry, stop and targets in R, and how each one played out. ${TRADE_DISCLAIMER}`,
    items: (await getTrades()).slice(0, FEED_LIMIT).map(tradeFeedItem),
  });
