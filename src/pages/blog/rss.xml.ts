import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { SITE } from '../../data/site.ts';
import { FEED_LIMIT, feedChannel, getPosts, postFeedItem } from '../../lib/content.ts';

export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/blog/rss.xml', '/blog/'),
    title: `Writing · ${SITE.title}`,
    description: `Essays and long-form writing by ${SITE.name}.`,
    items: (await getPosts()).slice(0, FEED_LIMIT).map(postFeedItem),
  });
