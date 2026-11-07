import type { APIRoute } from 'astro';
import { SITE } from '../data/site';

/**
 * /robots.txt — everything is crawlable except the CMS (which also sends X-Robots-Tag: noindex).
 * The sitemap URL comes from SITE.url so it stays right if the domain ever changes.
 */
export const GET: APIRoute = () => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    '',
    `Sitemap: ${new URL('/sitemap-index.xml', SITE.url).href}`,
    '',
  ].join('\n');

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
