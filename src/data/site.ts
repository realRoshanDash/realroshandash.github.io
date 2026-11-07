/**
 * Single source of truth for site-wide identity, navigation and public profiles.
 * Private contact details (email etc.) are NOT here — they live encrypted in
 * src/data/contact.sealed.json and are only revealed by the captcha gate on /contact.
 * Regenerate that file with `npm run seal-contact` (see README).
 */
export const SITE = {
  name: 'Roshan Dash',
  shortName: 'Roshan',
  url: 'https://roshandash.com',
  /** Default <title> suffix and OG site name. */
  title: 'Roshan Dash',
  description:
    'Roshan Dash — software engineer in Singapore working on distributed systems, Java, databases and system design, with AI agents and agentic workflows at the core of how he builds.',
  locale: 'en-SG',
  lang: 'en',
  location: 'Singapore',
  timezone: 'Asia/Singapore',
  alumni: 'IIT Guwahati',
  expertise: ['Java', 'Distributed systems', 'Databases', 'System design', 'Backend engineering', 'AI agents', 'Agentic workflows'],
  interests: ['Reading', 'Photography', 'Travel'],
  repo: 'roshandash411/roshandash411.github.io',
} as const;

export const SOCIALS = [
  { label: 'GitHub', handle: 'roshandash411', href: 'https://github.com/roshandash411' },
  { label: 'LinkedIn', handle: 'roshan-dash', href: 'https://www.linkedin.com/in/roshan-dash' },
] as const;

/**
 * Primary navigation (the logo links home). The site is professional-only: sections that have
 * no published entries (e.g. trade ideas, notes) stay out of the nav until something is published.
 * `anchor` is the matching section on the home page; links use it until `href`'s page is built
 * (see src/lib/routes.ts), so the nav never points at a page that doesn't exist yet.
 */
export const NAV = [
  { label: 'Writing', href: '/blog/', anchor: '/#writing' },
  { label: 'About', href: '/about/', anchor: '/#about' },
  { label: 'Contact', href: '/contact/', anchor: '/#contact' },
] as const;

/**
 * Whether this build ships the ⌘K command palette (design spec §4.5). Until it does, no search button, menu
 * entry or shortcut hint is rendered, so the chrome never offers a control that does nothing.
 */
export const HAS_PALETTE = true;

export const TRADE_DISCLAIMER =
  'Trade ideas are personal notes and opinions for educational purposes — not financial advice. I may hold positions in the instruments discussed. Do your own research; markets can and do go against you.';
