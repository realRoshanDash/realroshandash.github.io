/**
 * Navigation built from what this build actually has (design spec §4.2, §4.6, §4.21).
 *
 * The primary items (NAV in src/data/site.ts: Writing, About, Contact) are always listed. The dormant sections
 * join them only once they have a published entry, because until then their pages, feeds and sitemap entries are
 * not generated at all:
 * - Notes: the header, the mobile menu and the footer index.
 * - Trade ideas: the footer index only, so the header stays professional (§4.21), unless SHOW_TRADES_IN_NAV.
 * Drafts count only where they are shown (`astro dev`, SHOW_DRAFTS=1 previews), like everywhere else.
 */
import { NAV } from '../data/site.ts';
import { getNotes, getTrades } from './content.ts';

/** Also list "Trade ideas" in the header and mobile menu, not just the footer index. Off by default (§4.21). */
export const SHOW_TRADES_IN_NAV = false;

export interface NavItem {
  label: string;
  /** The section's page. */
  href: string;
  /** Where to link until that page is built (see linkTo in src/lib/routes.ts). */
  anchor: string;
}

/** `header`: the primary navigation and the mobile menu. `footer`: the footer index (every built section). */
export type NavPlacement = 'header' | 'footer';

export async function getNav(placement: NavPlacement = 'header'): Promise<NavItem[]> {
  const [notes, trades] = await Promise.all([getNotes(), getTrades()]);
  const items: NavItem[] = NAV.map(({ label, href, anchor }) => ({ label, href, anchor }));
  if (notes.length > 0) items.push({ label: 'Notes', href: '/notes/', anchor: '/notes/' });
  if (trades.length > 0 && (placement === 'footer' || SHOW_TRADES_IN_NAV)) {
    items.push({ label: 'Trade ideas', href: '/trades/', anchor: '/trades/' });
  }
  return items;
}
