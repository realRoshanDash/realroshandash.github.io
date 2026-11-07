/**
 * Display formatting for prices, R-multiples, percentages, dates and counts. Pure (no Astro imports), so it
 * runs in `node --test`, at build time and in the browser.
 *
 * Conventions:
 * - Percentages are in percent units: 5.2 means 5.2 % (pctMove, computeStats().winRate and formatPct agree).
 * - Negative numbers use a real minus sign (U+2212), the same width as "+" in tabular figures.
 * - Missing or non-finite values render as EMPTY (an em dash), never "NaN".
 * - Dates are shown on the Singapore calendar. Frontmatter dates are date-only, which Zod parses as UTC
 *   midnight; Singapore is UTC+8 all year, so that instant is the same calendar day there on any build machine.
 */
import { SITE } from '../data/site.ts';

export const EMPTY = '—';
const MINUS = '\u2212';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type DateInput = Date | string | number;

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const withMinus = (formatted: string) => formatted.replace('-', MINUS);

function toDate(input: DateInput): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
/** Fixed-decimals formatter. Signed: +1.8 / -1.0 / 0.0. Unsigned: no "+", and never "-0.00". */
function fixed(digits: number, signed: boolean): Intl.NumberFormat {
  const key = `${digits}:${signed}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(SITE.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: signed ? 'exceptZero' : 'negative',
    });
    numberFormats.set(key, format);
  }
  return format;
}

/** 182.50 · 1,234.50 · 0.4321 — 2 dp, or 4 dp below 1. No currency symbol: quotes aren't always in USD. */
export function formatPrice(value: number | null | undefined): string {
  if (!isNum(value)) return EMPTY;
  return withMinus(fixed(value !== 0 && Math.abs(value) < 1 ? 4 : 2, false).format(value));
}

/** +1.8R · −1.0R · 0.0R (a value that rounds to zero gets no sign). */
export function formatR(r: number | null | undefined, digits = 1): string {
  return isNum(r) ? `${withMinus(fixed(digits, true).format(r))}R` : EMPTY;
}

/** +5.2% · −3.4% · 0.0%. Use { signed: false } for rates, e.g. a 62.5% win rate. */
export function formatPct(
  pct: number | null | undefined,
  { signed = true, digits = 1 }: { signed?: boolean; digits?: number } = {},
): string {
  return isNum(pct) ? `${withMinus(fixed(digits, signed).format(pct))}%` : EMPTY;
}

const dateFormat = new Intl.DateTimeFormat(SITE.locale, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: SITE.timezone,
});
const ymdFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: SITE.timezone,
});

/** Calendar date in the site's time zone as [year, month, day] strings. */
function ymd(date: Date): [string, string, string] {
  const parts: Record<string, string> = {};
  for (const { type, value } of ymdFormat.formatToParts(date)) parts[type] = value;
  return [parts.year, parts.month, parts.day];
}

/** "7 Nov 2026" (Singapore calendar; the en-SG locale writes September as "Sept"). */
export function formatDate(input: DateInput): string {
  const date = toDate(input);
  return date ? dateFormat.format(date) : EMPTY;
}

/** "2026-11-07" (Singapore calendar) for <time datetime>, sitemaps and JSON-LD; '' for an invalid date. */
export function formatDateISO(input: DateInput): string {
  const date = toDate(input);
  return date ? ymd(date).join('-') : '';
}

const relative = new Intl.RelativeTimeFormat(SITE.locale, { numeric: 'auto' });

/** Days since the epoch on the Singapore calendar. */
function dayNumber(date: Date): number {
  const [y, m, d] = ymd(date).map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
}

/**
 * "now" · "5 minutes ago" · "in 3 hours" · "yesterday" · "last week" · "2 months ago".
 * Under a day it counts elapsed time; from a day on it counts Singapore calendar days, so a date-only value
 * from yesterday reads "yesterday" at any hour. On a static page the result is frozen at build time.
 */
export function relativeTime(input: DateInput, now: Date = new Date()): string {
  const date = toDate(input);
  if (!date) return EMPTY;
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return relative.format(0, 'second');
  if (abs < HOUR) return relative.format(Math.trunc(diff / MINUTE), 'minute');
  if (abs < DAY) return relative.format(Math.trunc(diff / HOUR), 'hour');

  const days = dayNumber(date) - dayNumber(now);
  const n = Math.abs(days);
  const sign = Math.sign(days);
  if (n < 7) return relative.format(days, 'day');
  if (n < 28) return relative.format(sign * Math.trunc(n / 7), 'week');
  if (n < 365) return relative.format(sign * Math.min(11, Math.max(1, Math.round(n / 30.4375))), 'month');
  return relative.format(sign * Math.max(1, Math.round(n / 365.25)), 'year');
}

/** Compact countdown, the two largest units rounded down: "2d 4h" · "3h 12m" · "12m" · "45s". */
export function formatDuration(ms: number): string {
  if (!isNum(ms)) return EMPTY;
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${m}m` : `${total}s`;
}

const countFormat = new Intl.NumberFormat(SITE.locale);

/** "1 idea" · "3 ideas" · "1,234 words". Pass the plural for irregular nouns: pluralize(n, 'entry', 'entries'). */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${countFormat.format(count)} ${count === 1 ? singular : plural}`;
}
