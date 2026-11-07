/**
 * Trade-idea maths: risk, R-multiples, results and track-record stats. Pure (no Astro imports), so
 * `node --test` can cover it; pages pass `entry.data`, tests pass plain objects.
 *
 * 1R is the planned risk per share, |entry − stop|. A target or exit is worth reward ÷ risk, signed by
 * direction: a long stopped at its stop is −1R, a short covered twice its risk below entry is +2R.
 * Percentages are in percent units (5.2 = 5.2 %), as formatPct expects.
 */
// Type-only, so it is erased at runtime and `node --test` never loads astro:content.
import type { TRADE_DIRECTIONS, TRADE_STATUSES, TRADE_TIMEFRAMES } from '../content.config.ts';
import { formatDate, formatPct, formatPrice, formatR, pluralize } from './format.ts';

export type TradeDirection = (typeof TRADE_DIRECTIONS)[number];
export type TradeStatus = (typeof TRADE_STATUSES)[number];
export type TradeTimeframe = (typeof TRADE_TIMEFRAMES)[number];

/** Direction, entry and stop: enough to express any price in R. */
export interface TradeLevels {
  direction: TradeDirection;
  entry: number;
  stop: number;
}

/** The frontmatter these helpers read. `CollectionEntry<'trades'>['data']` satisfies it. */
export interface TradeLike extends TradeLevels {
  status: TradeStatus;
  targets: readonly number[];
  exit?: number;
  published: Date;
  triggered?: Date;
  closed?: Date;
}

/** What a result needs: levels, status and (once closed or stopped) the average exit. */
export type TradeOutcome = TradeLevels & Pick<TradeLike, 'status' | 'exit'>;

const DAY_MS = 86_400_000;

/** Statuses with a known result (the schema requires an exit for both). */
const DECIDED: ReadonlySet<TradeStatus> = new Set<TradeStatus>(['closed', 'stopped']);

/** Planned risk per share, |entry − stop|. */
export function riskPerShare(t: TradeLevels): number {
  return Math.abs(t.entry - t.stop);
}

/** R-multiple of a price (a target or an exit). Null when the idea has no risk (entry = stop) or no price. */
export function rMultiple(t: TradeLevels, price: number): number | null {
  const risk = riskPerShare(t);
  if (!(risk > 0) || !Number.isFinite(risk) || !Number.isFinite(price)) return null;
  return (t.direction === 'long' ? price - t.entry : t.entry - price) / risk;
}

/** % move from entry to a price, positive when it favours the idea (up for a long, down for a short). */
export function pctMove(t: Pick<TradeLevels, 'direction' | 'entry'>, price: number): number | null {
  if (!(t.entry > 0) || !Number.isFinite(price)) return null;
  return ((t.direction === 'long' ? price - t.entry : t.entry - price) / t.entry) * 100;
}

export interface TargetLevel {
  price: number;
  r: number | null;
  pct: number | null;
}

/** Each target with its R-multiple and % move from entry, in frontmatter order. */
export function targetsWithR(t: TradeLevels & Pick<TradeLike, 'targets'>): TargetLevel[] {
  return t.targets.map((price) => ({ price, r: rMultiple(t, price), pct: pctMove(t, price) }));
}

/** Realised R of a closed or stopped idea (≈ −1R when stopped at the stop); null while open or undecided. */
export function resultR(t: TradeOutcome): number | null {
  return DECIDED.has(t.status) && t.exit !== undefined ? rMultiple(t, t.exit) : null;
}

/** Realised % move of a closed or stopped idea, signed like resultR. */
export function resultPct(t: TradeOutcome): number | null {
  return DECIDED.has(t.status) && t.exit !== undefined ? pctMove(t, t.exit) : null;
}

/** Calendar days from trigger (else publication) to close; null until there is a close date. */
export function holdingDays(t: Pick<TradeLike, 'published' | 'triggered' | 'closed'>): number | null {
  if (!t.closed) return null;
  const utcDay = (date: Date) => Math.floor(date.getTime() / DAY_MS);
  return Math.max(0, utcDay(t.closed) - utcDay(t.triggered ?? t.published));
}

/** TradingView symbol: the `tvSymbol` override, else EXCHANGE:TICKER (e.g. NASDAQ:NVDA). */
export function tvSymbol(t: { ticker: string; exchange: string; tvSymbol?: string }): string {
  return t.tvSymbol?.trim() || (t.exchange ? `${t.exchange}:${t.ticker}` : t.ticker);
}

export interface StatusMeta {
  label: string;
  /** Sort order for "most relevant first" lists: 0 = active … 4 = invalidated. */
  priority: number;
  /** Still live (watching or active) rather than finished. */
  open: boolean;
}

const STATUS_META: Record<TradeStatus, StatusMeta> = {
  active: { label: 'Active', priority: 0, open: true },
  watching: { label: 'Watching', priority: 1, open: true },
  closed: { label: 'Closed', priority: 2, open: false },
  stopped: { label: 'Stopped out', priority: 3, open: false },
  invalidated: { label: 'Invalidated', priority: 4, open: false },
};

export function statusMeta(status: TradeStatus): StatusMeta {
  return STATUS_META[status];
}

/** Sort comparator: status priority (active first), then newest published first. */
export function compareTrades(
  a: Pick<TradeLike, 'status' | 'published'>,
  b: Pick<TradeLike, 'status' | 'published'>,
): number {
  return STATUS_META[a.status].priority - STATUS_META[b.status].priority || b.published.getTime() - a.published.getTime();
}

/**
 * Track record over decided ideas (closed or stopped, with an exit). R is per idea, i.e. it assumes equal
 * risk on every idea. Undefined ratios are null, never NaN or Infinity; counts and totalR start at 0.
 */
export interface TradeStats {
  count: number;
  wins: number;
  losses: number;
  /** Exits exactly at entry. They count towards `count`, so they lower the win rate. */
  breakeven: number;
  /** Wins as a percentage of decided ideas (0–100). */
  winRate: number | null;
  totalR: number;
  avgR: number | null;
  bestR: number | null;
  worstR: number | null;
  avgWinR: number | null;
  /** Mean R of the losers (a negative number). */
  avgLossR: number | null;
  /** Expected R per idea, winRate × avgWin + lossRate × avgLoss. Equal to avgR; shown under its usual name. */
  expectancy: number | null;
  /** Gross R won ÷ gross R lost. Null when nothing has been lost yet. */
  profitFactor: number | null;
}

export function computeStats(trades: readonly TradeOutcome[]): TradeStats {
  const rs = trades.map((t) => resultR(t)).filter((r): r is number => r !== null);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const sum = (xs: readonly number[]) => xs.reduce((total, x) => total + x, 0);
  const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : null);

  const count = rs.length;
  const avgWinR = mean(wins);
  const avgLossR = mean(losses);
  const grossLoss = -sum(losses);
  return {
    count,
    wins: wins.length,
    losses: losses.length,
    breakeven: count - wins.length - losses.length,
    winRate: count ? (wins.length / count) * 100 : null,
    totalR: sum(rs),
    avgR: mean(rs),
    bestR: count ? rs.reduce((a, b) => Math.max(a, b)) : null,
    worstR: count ? rs.reduce((a, b) => Math.min(a, b)) : null,
    avgWinR,
    avgLossR,
    expectancy: count ? (wins.length / count) * (avgWinR ?? 0) + (losses.length / count) * (avgLossR ?? 0) : null,
    profitFactor: grossLoss > 0 ? sum(wins) / grossLoss : null,
  };
}

export type TradeSynopsisInput = TradeLike & { ticker: string; setup: string; timeframe: TradeTimeframe };

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

function statusSentence(t: TradeLike): string {
  const { label } = statusMeta(t.status);
  switch (t.status) {
    case 'watching':
      return `${label}: not triggered yet.`;
    case 'active':
      return `${label} since ${formatDate(t.triggered ?? t.published)}.`;
    case 'invalidated':
      return `${label}: never triggered.`;
    default: {
      const r = resultR(t);
      if (r === null) return `${label}.`;
      const days = holdingDays(t);
      const on = t.closed ? ` on ${formatDate(t.closed)}` : '';
      const held = days === null ? '' : days === 0 ? ', same day' : ` after ${pluralize(days, 'day')}`;
      return `${label} at ${formatPrice(t.exit)}${on}: ${formatR(r)} (${formatPct(resultPct(t))})${held}.`;
    }
  }
}

/**
 * Plain-text synopsis for feeds and meta descriptions:
 * "Long NVDA · Breakout retest · Swing. Entry 182.50, stop 174.00, targets 199.50 (+2.0R), 210.00 (+3.2R).
 *  Active since 3 Nov 2026."
 */
export function tradeSynopsis(t: TradeSynopsisInput): string {
  const targets = targetsWithR(t)
    .map(({ price, r }) => `${formatPrice(price)} (${formatR(r)})`)
    .join(', ');
  return [
    `${capitalize(t.direction)} ${t.ticker} · ${t.setup} · ${capitalize(t.timeframe)}.`,
    `Entry ${formatPrice(t.entry)}, stop ${formatPrice(t.stop)}, ${t.targets.length === 1 ? 'target' : 'targets'} ${targets}.`,
    statusSentence(t),
  ].join(' ');
}
