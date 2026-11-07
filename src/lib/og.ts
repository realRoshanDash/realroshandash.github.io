/**
 * Which Open Graph card each page gets (design spec §6.4). One list feeds both the prerendered PNG endpoint
 * (src/pages/og/[...slug].png.ts) and Base.astro's og:image, so a page can only point at a card that is built.
 *
 *   /og/default.png             Home, and every page without a card of its own (404, notes, dormant sections)
 *   /og/about.png  /og/contact.png  /og/blog.png
 *   /og/blog/tags/<tag>.png     each tag page
 *   /og/blog/<post-id>.png      each post
 *
 * Rendering (satori + sharp) lives in og-render.ts and is imported only by the endpoint.
 */
import type { OgCard } from './og-render.ts';
import { SITE } from '../data/site.ts';
import { entryPath, getPosts, getTags, hasTag } from './content.ts';
import { formatDateISO, pluralize } from './format.ts';
import { minutesToRead, truncate } from './text.ts';

export interface OgImage {
  /** Endpoint param: "default", "about", "blog/tags/java", "blog/<post-id>"… */
  slug: string;
  /** Site-relative URL of the PNG. */
  src: string;
  /** og:image:alt */
  alt: string;
  /** The page this card is for; undefined for the fallback. */
  page?: string;
  card: OgCard;
}

const ROLE = `software engineer in ${SITE.location}`;
const FALLBACK = 'default';

const image = (slug: string, alt: string, card: OgCard, page?: string): OgImage => ({
  slug,
  src: `/og/${slug}.png`,
  alt,
  page,
  card,
});

async function build(): Promise<OgImage[]> {
  const posts = await getPosts();
  const tags = await getTags('blog');
  // "No. 001" is the oldest post (spec §4.12), as in the Writing list.
  const oldestFirst = [...posts].sort((a, b) => a.data.published.getTime() - b.data.published.getTime());

  return [
    image(FALLBACK, `${SITE.name}, ${ROLE}`, { kind: 'site' }, '/'),
    image('about', `About — ${SITE.name}, ${ROLE}`, {
      kind: 'page',
      route: '/about',
      eyebrow: 'About',
      title: 'About',
      lead: `Software engineer in ${SITE.location}.`,
      sub: 'Java, distributed systems, databases and system design — with AI agents in the loop.',
      role: `Software engineer · ${SITE.alumni} alumnus`,
    }, '/about/'),
    image('contact', `Contact — ${SITE.name}, ${ROLE}`, {
      kind: 'page',
      route: '/contact',
      eyebrow: 'Contact',
      title: 'Contact',
      lead: 'Write to me — the inbox is one small proof away.',
      sub: 'My email is encrypted on the page. Your browser decrypts it after a short proof-of-work — about a second, no tracking.',
    }, '/contact/'),
    image('blog', `Writing — ${SITE.name}, ${ROLE}`, {
      kind: 'page',
      route: '/blog',
      eyebrow: posts.length > 0 ? `Writing · ${pluralize(posts.length, 'post')}` : 'Writing',
      title: 'Writing',
      lead: 'Long-form notes on backend systems, distributed systems, databases and building with AI agents.',
    }, '/blog/'),
    ...tags.map(({ tag, slug, count }) => {
      const latest = posts.find((post) => hasTag(post, slug));
      return image(`blog/tags/${slug}`, `Writing tagged “${tag}” — ${SITE.name}`, {
        kind: 'page',
        route: `/blog/tags/${slug}`,
        eyebrow: `Tag · ${pluralize(count, 'post')}`,
        title: tag,
        lead: `Writing tagged “${tag}”.`,
        sub: latest ? `Latest: ${truncate(latest.data.title, 80)}` : undefined,
      }, `/blog/tags/${slug}/`);
    }),
    ...posts.map((post) =>
      image(`blog/${post.id}`, post.data.title, {
        kind: 'post',
        title: post.data.title,
        no: oldestFirst.indexOf(post) + 1,
        minutes: minutesToRead(post.body),
        date: formatDateISO(post.data.published),
        tags: post.data.tags,
        draft: post.data.draft,
      }, entryPath('blog', post.id)),
    ),
  ];
}

// One list per build; in dev it is rebuilt per request so edited content shows up.
let built: Promise<OgImage[]> | undefined;
export function ogImages(): Promise<OgImage[]> {
  if (import.meta.env.DEV) return build();
  built ??= build();
  return built;
}

/** The card for a page path ("/", "/blog/some-post/"); the site card when the page has none of its own. */
export async function ogImageFor(pathname: string): Promise<Pick<OgImage, 'src' | 'alt'>> {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const all = await ogImages();
  const match = all.find((og) => og.page === path) ?? all.find((og) => og.slug === FALLBACK)!;
  return { src: match.src, alt: match.alt };
}
