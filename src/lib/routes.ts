/**
 * Which pages this build actually has. Navigation and calls to action link to a section's own page once that page
 * exists and fall back to its anchor on the home page until then, so a deploy never ships a link to a page that
 * hasn't been built yet (and the links upgrade themselves the moment it is).
 *
 * The glob is lazy and `?raw`, so only the file names are used: no page module is ever imported or evaluated.
 */
const PAGE_FILES = Object.keys(import.meta.glob('/src/pages/**/*.{astro,md,mdx,html}', { query: '?raw' }));

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** /src/pages/blog/[...slug].astro → ^/blog/.+$ · /src/pages/about.astro → ^/about$ · index → ^$ */
function routePattern(file: string): RegExp {
  const route = file
    .replace(/^\/src\/pages/, '')
    .replace(/\.(astro|mdx?|html)$/, '')
    .replace(/(^|\/)index$/, '');
  const source = route
    .split('/')
    .map((segment) => (segment.startsWith('[...') ? '.+' : segment.startsWith('[') ? '[^/]+' : escapeRe(segment)))
    .join('/');
  return new RegExp(`^${source}$`);
}

const ROUTES = PAGE_FILES.filter((file) => !/(^|\/)_/.test(file.replace(/^\/src\/pages/, ''))).map(routePattern);

/** Whether a site-relative path (e.g. "/blog/", "/blog/some-post/") is served by a page in this build. */
export function routeExists(path: string): boolean {
  const pathname = new URL(path, 'https://example.invalid').pathname.replace(/\/+$/, '');
  return ROUTES.some((route) => route.test(pathname));
}

/** `href` when its page exists, otherwise the on-page fallback. */
export function linkTo(href: string, fallback: string): string {
  return routeExists(href) ? href : fallback;
}
