/**
 * Navigation built from what this build actually has (design spec §4.2, §4.6, §4.21).
 *
 * The primary items (NAV in src/data/site.ts: Writing, About, Contact) are always listed, in the header, the mobile
 * menu and the footer index. Of the dormant sections, which have no pages, feeds or sitemap entries until something
 * is published:
 * - Trade ideas join the footer index only, never the header (§4.2, §4.21), unless SHOW_TRADES_IN_NAV.
 * - Notes never get a nav item of their own: once published they appear in the Writing index under a "Notes" chip
 *   (§4.21; src/components/writing/TagFilter.astro).
 * Drafts count only where they are shown (`astro dev`, SHOW_DRAFTS=1 previews), like everywhere else.
 */
import { NAV, SHOW_TRADES_IN_NAV } from '../data/site.ts';
import { getTrades } from './content.ts';

export interface NavItem {
  label: string;
  /** The section's page. */
  href: string;
  /** Where to link until that page is built (see linkTo in src/lib/routes.ts). */
  anchor: string;
}

/** `header`: the primary navigation and the mobile menu. `footer`: the footer index. */
export type NavPlacement = 'header' | 'footer';

export async function getNav(placement: NavPlacement = 'header'): Promise<NavItem[]> {
  const items: NavItem[] = NAV.map(({ label, href, anchor }) => ({ label, href, anchor }));
  if ((placement === 'footer' || SHOW_TRADES_IN_NAV) && (await getTrades()).length > 0) {
    items.push({ label: 'Trade ideas', href: '/trades/', anchor: '/trades/' });
  }
  return items;
}
