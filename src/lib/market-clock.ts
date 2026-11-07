/**
 * US equities session clock: which session is live, when it next changes, and how that reads in Singapore.
 * Pure and dependency-free. New York wall-clock times are converted with Intl.DateTimeFormat
 * (America/New_York), so daylight saving is always right. Runs in `node --test`, at build time and in the browser.
 *
 * Sessions on a trading day, New York time (NYSE Arca early and late trading around the core session):
 *   pre-market 04:00–09:30 · regular 09:30–16:00 · post-market 16:00–20:00
 * On early-close days the regular session ends at 13:00 and late trading at 17:00.
 *
 * Holiday and early-close calendar for 2026–2028, from NYSE Group:
 *   https://www.nyse.com/markets/hours-calendars
 *   https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx
 *   (press release of 23 Dec 2025). Add later years when NYSE publishes them; outside CALENDAR_YEARS every
 *   weekday is treated as a full trading day.
 */

export type MarketPhase = 'pre' | 'open' | 'post' | 'closed';
export type ClosedReason = 'weekend' | 'holiday' | 'overnight';

export const NEW_YORK = 'America/New_York';
export const SINGAPORE = 'Asia/Singapore';

export const CALENDAR_YEARS = [2026, 2027, 2028] as const;

/** NYSE full-day closures, keyed by New York date. */
export const HOLIDAYS: Readonly<Record<string, string>> = {
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King, Jr. Day',
  '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth National Independence Day',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',

  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King, Jr. Day',
  '2027-02-15': "Washington's Birthday",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth National Independence Day (observed)',
  '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving Day',
  '2027-12-24': 'Christmas Day (observed)',

  // New Year's Day 2028 falls on a Saturday and is not observed: Friday 31 Dec 2027 is a full trading day.
  '2028-01-17': 'Martin Luther King, Jr. Day',
  '2028-02-21': "Washington's Birthday",
  '2028-04-14': 'Good Friday',
  '2028-05-29': 'Memorial Day',
  '2028-06-19': 'Juneteenth National Independence Day',
  '2028-07-04': 'Independence Day',
  '2028-09-04': 'Labor Day',
  '2028-11-23': 'Thanksgiving Day',
  '2028-12-25': 'Christmas Day',
};

/** NYSE early closes (regular session ends 13:00, late trading 17:00), keyed by New York date. */
export const EARLY_CLOSES: Readonly<Record<string, string>> = {
  '2026-11-27': 'Day after Thanksgiving',
  '2026-12-24': 'Christmas Eve',
  '2027-11-26': 'Day after Thanksgiving',
  '2028-07-03': 'Day before Independence Day',
  '2028-11-24': 'Day after Thanksgiving',
};

export const PHASE_LABELS: Readonly<Record<MarketPhase, string>> = {
  pre: 'Pre-market',
  open: 'Market open',
  post: 'After hours',
  closed: 'Market closed',
};

export interface Session {
  start: Date;
  end: Date;
}

export interface Sessions {
  pre: Session;
  regular: Session;
  post: Session;
}

export interface MarketDay {
  /** New York calendar date, YYYY-MM-DD. */
  date: string;
  status: 'trading' | 'weekend' | 'holiday';
  holidayName?: string;
  earlyClose: boolean;
  /** Session boundaries as instants; only on trading days. */
  sessions?: Sessions;
}

export interface MarketClock {
  phase: MarketPhase;
  /**
   * Why the market is closed (phase 'closed' only), judged by the New York date: a Saturday or Sunday is
   * 'weekend', an NYSE holiday is 'holiday', and a trading day before 04:00 or after late trading is
   * 'overnight' — including Friday night, which rolls over to Monday's pre-market.
   */
  reason?: ClosedReason;
  holidayName?: string;
  /** Today (New York date) is an early-close day. */
  earlyClose: boolean;
  /** When the phase next changes, and to what. */
  nextChange: Date;
  nextPhase: MarketPhase;
  /** Start of the next regular session, for "opens in …" while the next change is only the pre-market. */
  nextOpen: Date;
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface WallClock extends CivilDate {
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = ({ year, month, day }: CivilDate) => `${year}-${pad(month)}-${pad(day)}`;
const weekdayOf = ({ year, month, day }: CivilDate) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

function addDays({ year, month, day }: CivilDate, days: number): CivilDate {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const partFormats = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock reading of an instant in a time zone, e.g. wallClock(now, SINGAPORE).hour. */
export function wallClock(date: Date, timeZone: string): WallClock {
  let format = partFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partFormats.set(timeZone, format);
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const { type, value } of format.formatToParts(date)) if (type !== 'literal') parts[type] = Number(value);
  const civil = { year: parts.year ?? 0, month: parts.month ?? 0, day: parts.day ?? 0 };
  return {
    ...civil,
    hour: (parts.hour ?? 0) % 24, // some engines print midnight as 24 even with h23
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
    weekday: weekdayOf(civil),
  };
}

/** UTC offset of a time zone at an instant, in ms (New York: −4 h in summer, −5 h in winter). */
function offsetMs(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone);
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - wholeSeconds;
}

/**
 * The instant a New York wall-clock time occurs. The offset is re-read at the first estimate in case a DST
 * switch lies between; session times never fall in the 02:00–03:00 gap or the repeated hour.
 */
function newYorkInstant(date: CivilDate, hour: number, minute = 0): Date {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const estimate = asUtc - offsetMs(new Date(asUtc), NEW_YORK);
  return new Date(asUtc - offsetMs(new Date(estimate), NEW_YORK));
}

function describeDay(date: CivilDate): MarketDay {
  const key = isoDate(date);
  const weekday = weekdayOf(date);
  if (weekday === 0 || weekday === 6) return { date: key, status: 'weekend', earlyClose: false };
  const holidayName = HOLIDAYS[key];
  if (holidayName) return { date: key, status: 'holiday', holidayName, earlyClose: false };

  const earlyClose = Object.hasOwn(EARLY_CLOSES, key);
  const open = newYorkInstant(date, 9, 30);
  const close = newYorkInstant(date, earlyClose ? 13 : 16);
  return {
    date: key,
    status: 'trading',
    earlyClose,
    sessions: {
      pre: { start: newYorkInstant(date, 4), end: open },
      regular: { start: open, end: close },
      post: { start: close, end: newYorkInstant(date, earlyClose ? 17 : 20) },
    },
  };
}

/** Sessions of the first trading day after `date` (closures never run longer than a few days). */
function nextSessions(date: CivilDate): Sessions {
  for (let i = 1; i <= 14; i++) {
    const { sessions } = describeDay(addDays(date, i));
    if (sessions) return sessions;
  }
  throw new Error(`No US trading day within 14 days after ${isoDate(date)}`);
}

/** The New York market day containing an instant, or for a YYYY-MM-DD New York date. */
export function marketDay(at: Date | string): MarketDay {
  if (typeof at !== 'string') return describeDay(wallClock(at, NEW_YORK));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
  const date = match && { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!date || isoDate(addDays(date, 0)) !== at) throw new RangeError(`Expected a valid YYYY-MM-DD date, got "${at}"`);
  return describeDay(date);
}

/** Market phase at an instant (default: now). Each session's start is inclusive, its end exclusive. */
export function marketClock(now: Date = new Date()): MarketClock {
  const t = now.getTime();
  const today = wallClock(now, NEW_YORK);
  const day = describeDay(today);
  const s = day.sessions;

  if (!s) {
    const next = nextSessions(today);
    return {
      phase: 'closed',
      reason: day.status === 'holiday' ? 'holiday' : 'weekend',
      holidayName: day.holidayName,
      earlyClose: false,
      nextChange: next.pre.start,
      nextPhase: 'pre',
      nextOpen: next.regular.start,
    };
  }

  const { earlyClose } = day;
  if (t < s.pre.start.getTime()) {
    return { phase: 'closed', reason: 'overnight', earlyClose, nextChange: s.pre.start, nextPhase: 'pre', nextOpen: s.regular.start };
  }
  if (t < s.regular.start.getTime()) {
    return { phase: 'pre', earlyClose, nextChange: s.regular.start, nextPhase: 'open', nextOpen: s.regular.start };
  }
  const next = nextSessions(today);
  if (t < s.regular.end.getTime()) {
    return { phase: 'open', earlyClose, nextChange: s.regular.end, nextPhase: 'post', nextOpen: next.regular.start };
  }
  if (t < s.post.end.getTime()) {
    return { phase: 'post', earlyClose, nextChange: s.post.end, nextPhase: 'closed', nextOpen: next.regular.start };
  }
  return { phase: 'closed', reason: 'overnight', earlyClose, nextChange: next.pre.start, nextPhase: 'pre', nextOpen: next.regular.start };
}

function formatClock(date: Date, timeZone: string, label: string, weekday: boolean): string {
  const w = wallClock(date, timeZone);
  return `${weekday ? `${WEEKDAYS[w.weekday]} ` : ''}${pad(w.hour)}:${pad(w.minute)} ${label}`;
}

/** An instant in Singapore time: "22:30 SGT", or "Tue 05:00 SGT" with { weekday: true }. */
export function formatSGT(date: Date, { weekday = false }: { weekday?: boolean } = {}): string {
  return formatClock(date, SINGAPORE, 'SGT', weekday);
}

/** An instant in New York time: "09:30 ET", or "Mon 09:30 ET" with { weekday: true }. */
export function formatET(date: Date, { weekday = false }: { weekday?: boolean } = {}): string {
  return formatClock(date, NEW_YORK, 'ET', weekday);
}
