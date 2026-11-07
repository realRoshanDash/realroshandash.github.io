import type { APIRoute } from 'astro';
import { SITE } from '../data/site.ts';

/**
 * /robots.txt — everything is crawlable, the CMS included. /admin/ is kept out of search results by its
 * <meta name="robots" content="noindex">, which a crawler only sees if it may fetch the page: a Disallow here
 * would hide that tag and could still let the bare URL be indexed from links.
 * The sitemap URL comes from SITE.url so it stays right if the domain ever changes.
 */
export const GET: APIRoute = () => {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${new URL('/sitemap-index.xml', SITE.url).href}`,
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
