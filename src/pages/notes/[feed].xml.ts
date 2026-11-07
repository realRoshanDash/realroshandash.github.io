import rss from '@astrojs/rss';
import type { APIRoute, GetStaticPaths } from 'astro';
import { SITE } from '../../data/site.ts';
import { FEED_LIMIT, feedChannel, getNotes, noteFeedItem } from '../../lib/content.ts';

/** /notes/rss.xml exists only once a note is published (the section is hidden until then). */
export const getStaticPaths = (async () => ((await getNotes()).length ? [{ params: { feed: 'rss' } }] : [])) satisfies GetStaticPaths;

export const GET: APIRoute = async () =>
  rss({
    ...feedChannel('/notes/rss.xml', '/notes/'),
    title: `Notes · ${SITE.title}`,
    description: `Short notes by ${SITE.name}: engineering, links and things learned.`,
    items: (await getNotes()).slice(0, FEED_LIMIT).map(noteFeedItem),
  });
