/**
 * What the ⌘K palette knows at build time (serialised into its dialog on every page): the pages, the posts that
 * have a page in this build, the profiles, and where to verify the email. Built once per build.
 */
import { SITE, SOCIALS } from '@/data/site';
import { entryPath, getPosts } from '@/lib/content';
import { formatDateISO } from '@/lib/format';
import type { PaletteData } from '@/lib/palette';
import { linkTo, routeExists } from '@/lib/routes';
import { minutesToRead } from '@/lib/text';

/** The empty state previews the latest posts; only those carry a description. */
const LATEST = 3;
/**
 * Posts serialised into every page. A built site ships only the latest few: Pagefind searches every post and its
 * hits carry their own title, date and minutes. `astro dev` has no index, so there the titles of up to 100 posts
 * ship for title search. (100 posts would be ~4–5 KB gzip on every page, against the 35 KB HTML budget.)
 */
const MAX_POSTS = import.meta.env.DEV ? 100 : LATEST;

async function build(): Promise<PaletteData> {
  const posts = (await getPosts())
    .map((post) => ({ post, url: entryPath('blog', post.id) }))
    // the palette never links to a page that isn't built (e.g. before /blog/[slug] exists)
    .filter(({ url }) => routeExists(url))
    .slice(0, MAX_POSTS)
    .map(({ post, url }, i) => ({
      label: post.data.title,
      url,
      description: i < LATEST ? post.data.description : '',
      date: formatDateISO(post.data.published),
      minutes: minutesToRead(post.body),
      tags: post.data.tags.slice(0, 3),
      ...(post.data.draft ? { draft: true } : {}),
    }));

  return {
    pages: [
      {
        label: 'Home',
        url: '/',
        description: `Software engineer in ${SITE.location} — backend systems, with AI agents in the loop.`,
        keywords: ['start', 'index', SITE.name],
      },
      {
        label: 'Writing',
        url: linkTo('/blog/', '/#writing'),
        description: 'Long-form notes on backend systems, distributed systems, databases and building with AI agents.',
        keywords: ['blog', 'posts', 'articles', 'essays'],
      },
      {
        label: 'About',
        url: linkTo('/about/', '/#about'),
        description: 'A short index of who I am and what I work on.',
        keywords: ['profile', 'bio', 'education', SITE.alumni, SITE.location],
      },
      {
        label: 'Contact',
        url: linkTo('/contact/', '/#contact'),
        description:
          'My email is encrypted on this page. Your browser decrypts it after a short proof-of-work — about a second, no tracking.',
        keywords: ['email', 'mail', 'message', 'get in touch'],
      },
      {
        label: 'RSS feed',
        url: '/rss.xml',
        description: 'Subscribe via RSS: new writing, in your feed reader.',
        keywords: ['feed', 'subscribe', 'atom', 'xml'],
      },
    ],
    posts,
    elsewhere: SOCIALS.map((social) => ({
      label: social.label,
      url: social.href,
      description: `${social.label} profile: ${social.handle}.`,
      keywords: ['profile', social.handle],
    })),
    // lands on the gate (ContactGate's id), so the address it reveals is in view too
    verify: routeExists('/contact/') ? '/contact/?verify=1#contact-gate' : '/?verify=1#contact-gate',
  };
}

let built: Promise<PaletteData> | undefined;
export function getPaletteData(): Promise<PaletteData> {
  if (import.meta.env.DEV) return build();
  built ??= build();
  return built;
}
