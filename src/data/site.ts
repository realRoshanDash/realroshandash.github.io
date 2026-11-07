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
    'Software engineer in Singapore building distributed systems by day and trading US markets by night. Writing, trade ideas and side projects.',
  locale: 'en-SG',
  lang: 'en',
  location: 'Singapore',
  timezone: 'Asia/Singapore',
  /** US equities session the trade ideas refer to. */
  marketTimezone: 'America/New_York',
  alumni: 'IIT Guwahati',
  interests: ['Reading', 'Photography', 'Coding'],
  repo: 'roshandash411/roshandash411.github.io',
} as const;

export const SOCIALS = [
  { label: 'GitHub', handle: 'roshandash411', href: 'https://github.com/roshandash411' },
  { label: 'LinkedIn', handle: 'roshan-dash', href: 'https://www.linkedin.com/in/roshan-dash' },
] as const;

/** Primary navigation (the logo links home). */
export const NAV = [
  { label: 'Writing', href: '/blog/' },
  { label: 'Trade Ideas', href: '/trades/' },
  { label: 'Notes', href: '/notes/' },
  { label: 'About', href: '/about/' },
  { label: 'Contact', href: '/contact/' },
] as const;

export const TRADE_DISCLAIMER =
  'Trade ideas are personal notes and opinions for educational purposes — not financial advice. I may hold positions in the instruments discussed. Do your own research; markets can and do go against you.';
