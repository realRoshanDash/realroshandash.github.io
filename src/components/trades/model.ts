/**
 * View models for the dormant trade-idea components (design spec §4.21): the price ladder's geometry, the card's
 * R-bar, the update log and the stats cells. Pure (no Astro imports), so `node --test` covers it. The maths
 * (R-multiples, results, track record) lives in src/lib/trades.ts; this only arranges it for display.
 */
import { EMPTY, formatDateISO, formatPct, formatPrice, formatR } from '../../lib/format.ts';
import {
  computeStats,
  holdingDays,
  pctMove,
  resultPct,
  resultR,
  riskPerShare,
  rMultiple,
  statusMeta,
  type TradeLevels,
  type TradeLike,
  type TradeOutcome,
  type TradeStatus,
} from '../../lib/trades.ts';

/** "swing" → "Swing". */
export const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/* ------------------------------------------------------------------ targets ---- */

/** The target furthest from entry (the last one to be reached) and its R; null without risk. */
export function finalTarget(t: TradeLevels & Pick<TradeLike, 'targets'>): { index: number; price: number; r: number } | null {
  let best: { index: number; price: number; r: number } | null = null;
  for (const [index, price] of t.targets.entries()) {
    const r = rMultiple(t, price);
    if (r !== null && (best === null || r > best.r)) best = { index, price, r };
  }
  return best;
}

/** The price `r` multiples of risk away from entry, on the winning side for positive r. */
function priceAtR(t: TradeLevels, r: number): number {
  const risk = riskPerShare(t);
  return t.direction === 'long' ? t.entry + r * risk : t.entry - r * risk;
}

/* ------------------------------------------------------------------- ladder ---- */

export type LevelKind = 'target' | 'entry' | 'stop' | 'exit';

export interface LadderLevel {
  kind: LevelKind;
  /** Chip text: T1, T2 …, Entry, Stop, Exit. */
  name: string;
  price: number;
  /** R-multiple of the price: entry 0, stop −1. Null when the idea has no risk. */
  r: number | null;
  /** Where the price sits, as % of the plot height from the top. */
  y: number;
  /** Where its label row sits: y, unless that would crowd a neighbour (then it is pushed and gets a leader). */
  labelY: number;
}

export interface LadderModel {
  /** Top to bottom. */
  levels: LadderLevel[];
  /** R gridlines on the axis, every `step` R. */
  ticks: { r: number; y: number }[];
  /** Entry ↔ stop and entry ↔ furthest target, as top/bottom % of the plot. */
  risk: { top: number; bottom: number };
  reward: { top: number; bottom: number };
  /** Planned risk per share. */
  oneR: number;
}

export interface LadderInput extends TradeLevels {
  status: TradeStatus;
  targets: readonly number[];
  exit?: number;
}

/** The price range is padded by this fraction of its span, so the extreme levels never sit on the plot's edge. */
const RANGE_PAD = 0.08;
/** Label rows are kept at least this far apart (% of the plot): 24px on the shortest plot, 340px. */
export const LABEL_GAP = 7;
/** Labels stay inside this band of the plot (%), so a pushed row never leaves the box. */
const LABEL_MIN = 3.5;
const LABEL_MAX = 96.5;

const KIND_ORDER: Record<LevelKind, number> = { target: 0, exit: 1, entry: 2, stop: 3 };

/**
 * Keep label rows `gap` apart: push each one down from its neighbour above, then back up from the bottom edge.
 * The order (top to bottom) never changes, so each label stays next to its own level.
 */
export function spreadLabels(levels: { labelY: number }[], gap = LABEL_GAP, min = LABEL_MIN, max = LABEL_MAX): void {
  if (!levels.length) return;
  levels[0].labelY = Math.max(levels[0].labelY, min);
  for (let i = 1; i < levels.length; i++) levels[i].labelY = Math.max(levels[i].labelY, levels[i - 1].labelY + gap);
  const last = levels.length - 1;
  levels[last].labelY = Math.min(levels[last].labelY, max);
  for (let i = last - 1; i >= 0; i--) levels[i].labelY = Math.min(levels[i].labelY, levels[i + 1].labelY - gap);
}

/** Geometry of the price-level ladder: y = (max − price) / (max − min), on a range padded by 8%. */
export function ladderModel(t: LadderInput): LadderModel {
  const decided = (t.status === 'closed' || t.status === 'stopped') && t.exit !== undefined;
  const raw: { kind: LevelKind; name: string; price: number }[] = [
    ...t.targets.map((price, i) => ({ kind: 'target' as const, name: `T${i + 1}`, price })),
    { kind: 'entry', name: 'Entry', price: t.entry },
    { kind: 'stop', name: 'Stop', price: t.stop },
    ...(decided ? [{ kind: 'exit' as const, name: 'Exit', price: t.exit as number }] : []),
  ];
  const prices = raw.map((level) => level.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || Math.abs(hi) * 0.02 || 1;
  const max = hi + span * RANGE_PAD;
  const min = lo - span * RANGE_PAD;
  const y = (price: number) => ((max - price) / (max - min)) * 100;

  const levels: LadderLevel[] = raw
    .map((level) => ({ ...level, r: rMultiple(t, level.price), y: y(level.price), labelY: y(level.price) }))
    .sort((a, b) => a.y - b.y || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  spreadLabels(levels);

  // R gridlines: every 1R, or 2 / 5 / 10R when 1R would be under ~18px on the shortest plot (300px).
  const oneR = riskPerShare(t);
  const ticks: LadderModel['ticks'] = [];
  if (oneR > 0) {
    const pxPerR = (oneR / (max - min)) * 300;
    const step = [1, 2, 5, 10, 20, 50].find((s) => s * pxPerR >= 18) ?? 100;
    const rTop = rMultiple(t, max) as number;
    const rBottom = rMultiple(t, min) as number;
    const from = Math.ceil(Math.min(rTop, rBottom) / step) * step;
    const to = Math.floor(Math.max(rTop, rBottom) / step) * step;
    for (let r = to; r >= from; r -= step) ticks.push({ r, y: y(priceAtR(t, r)) });
  }

  const entryY = y(t.entry);
  const stopY = y(t.stop);
  const far = finalTarget(t);
  const farY = far ? y(far.price) : entryY;
  return {
    levels,
    ticks,
    risk: { top: Math.min(entryY, stopY), bottom: Math.max(entryY, stopY) },
    reward: { top: Math.min(entryY, farY), bottom: Math.max(entryY, farY) },
    oneR,
  };
}

/** The ladder in words, for its role="img" label: "Target 2 210.00, +3.2R. Target 1 … Stop 174.00, −1.0R." */
export function ladderLabel(model: LadderModel): string {
  const spoken = (level: LadderLevel) => {
    const name = level.kind === 'target' ? `Target ${level.name.slice(1)}` : level.name;
    const r = level.kind === 'entry' || level.r === null ? '' : `, ${formatR(level.r)}`;
    return `${name} ${formatPrice(level.price)}${r}`;
  };
  return `Price levels, highest first: ${model.levels.map(spoken).join('; ')}. 1R is ${formatPrice(model.oneR)}.`;
}

/* -------------------------------------------------------------------- R-bar ---- */

export interface RBarModel {
  /** Positions along the bar, % from the left. */
  stop: number;
  entry: number;
  target: number;
  exit: number | null;
  targetR: number;
  exitR: number | null;
  label: string;
}

/** The card's R-bar: risk (−1R → 0) against reward (0 → furthest target), with the exit once decided. */
export function rBarModel(t: TradeOutcome & Pick<TradeLike, 'targets'>): RBarModel | null {
  const far = finalTarget(t);
  if (!far) return null;
  const exitR = resultR(t);
  const lo = Math.min(-1, exitR ?? -1);
  const hi = Math.max(far.r, exitR ?? far.r);
  const at = (r: number) => ((r - lo) / (hi - lo)) * 100;
  const verb = t.status === 'stopped' ? 'stopped out' : 'closed';
  return {
    stop: at(-1),
    entry: at(0),
    target: at(far.r),
    exit: exitR === null ? null : at(exitR),
    targetR: far.r,
    exitR,
    label:
      `Risk 1R against a ${formatR(far.r).replace('+', '')} target` + (exitR === null ? '.' : `; ${verb} at ${formatR(exitR)}.`),
  };
}

/* -------------------------------------------------------------- update log ---- */

export type LogKind = 'published' | 'triggered' | 'update' | 'closed' | 'stopped' | 'invalidated';

export interface LogEvent {
  kind: LogKind;
  date: Date;
  /** Calendar days since the idea was logged (Singapore calendar). */
  day: number;
  title: string;
  text?: string;
}

export interface LogInput extends TradeLike {
  updated?: Date;
  updates: readonly { date: Date; note: string }[];
}

const KIND_RANK: Record<LogKind, number> = { published: 0, triggered: 1, update: 2, closed: 3, stopped: 3, invalidated: 3 };
const dayIndex = (date: Date) => Date.parse(`${formatDateISO(date)}T00:00:00Z`) / 86_400_000;

/** "Entry 182.50, stop 174.00, targets 199.50 and 210.00." */
export function planSentence(t: Pick<TradeLike, 'entry' | 'stop' | 'targets'>): string {
  const targets = t.targets.map(formatPrice);
  const list = targets.length > 1 ? `${targets.slice(0, -1).join(', ')} and ${targets.at(-1)}` : targets[0];
  return `Entry ${formatPrice(t.entry)}, stop ${formatPrice(t.stop)}, ${targets.length > 1 ? 'targets' : 'target'} ${list}.`;
}

/**
 * The idea's history, oldest first: when it was logged, triggered and closed (from the frontmatter dates), and
 * every entry of `updates`. An update written on the day the idea triggered or closed becomes that event's text
 * rather than a separate entry, so the log never says the same thing twice.
 */
export function tradeLog(t: LogInput): LogEvent[] {
  const pending = t.updates.map((update) => ({ ...update }));
  const claim = (date: Date): string | undefined => {
    const i = pending.findIndex((update) => formatDateISO(update.date) === formatDateISO(date));
    return i === -1 ? undefined : pending.splice(i, 1)[0].note;
  };

  const events: Omit<LogEvent, 'day'>[] = [{ kind: 'published', date: t.published, title: 'Idea logged', text: planSentence(t) }];
  if (t.triggered && t.status !== 'watching' && t.status !== 'invalidated') {
    events.push({ kind: 'triggered', date: t.triggered, title: `Triggered at ${formatPrice(t.entry)}`, text: claim(t.triggered) });
  }
  const r = resultR(t);
  if ((t.status === 'closed' || t.status === 'stopped') && t.closed && r !== null) {
    const verb = t.status === 'closed' ? 'Closed' : 'Stopped out';
    events.push({ kind: t.status, date: t.closed, title: `${verb} at ${formatPrice(t.exit)} · ${formatR(r)}`, text: claim(t.closed) });
  } else if (t.status === 'invalidated') {
    const date = t.closed ?? t.updated;
    if (date) events.push({ kind: 'invalidated', date, title: 'Invalidated: never triggered', text: claim(date) });
  }
  for (const update of pending) events.push({ kind: 'update', date: update.date, title: 'Update', text: update.note });

  const start = dayIndex(t.published);
  return events
    .map((event, i) => ({ event, i }))
    .sort((a, b) => dayIndex(a.event.date) - dayIndex(b.event.date) || KIND_RANK[a.event.kind] - KIND_RANK[b.event.kind] || a.i - b.i)
    .map(({ event }) => ({ ...event, day: Math.max(0, Math.round(dayIndex(event.date) - start)) }));
}

/* ------------------------------------------------------------------- stats ---- */

export interface StatCell {
  label: string;
  /** The number (or EMPTY), set large. */
  value: string;
  /** Unit after the value, set small: "%", "R", "days". */
  unit?: string;
  caption: string;
}

/** "+1.90R" → ["+1.90", "R"]; EMPTY stays EMPTY. */
function splitR(r: number | null, digits = 1): Pick<StatCell, 'value' | 'unit'> {
  return r === null ? { value: EMPTY } : { value: formatR(r, digits).slice(0, -1), unit: 'R' };
}

/** The /trades stats row (§4.21): computed from closed and stopped ideas only; open ideas are counted apart. */
export function trackRecordCells(trades: readonly (TradeOutcome & Pick<TradeLike, 'status'>)[]): StatCell[] {
  const stats = computeStats(trades);
  const open = trades.filter((t) => statusMeta(t.status).open).length;
  return [
    {
      label: 'Win rate',
      ...(stats.winRate === null ? { value: EMPTY } : { value: formatPct(stats.winRate, { signed: false, digits: 0 }).slice(0, -1), unit: '%' }),
      caption: stats.count ? `${stats.wins} of ${stats.count} closed` : 'No closed ideas yet',
    },
    { label: 'Avg R', ...splitR(stats.avgR, 2), caption: 'Per closed idea, equal risk' },
    { label: 'Closed ideas', value: String(stats.count), caption: 'Closed or stopped out' },
    { label: 'Open', value: String(open), caption: 'Active or watching' },
  ];
}

export interface IdeaStatsInput extends TradeLike {
  conviction?: number;
}

/** The stats row of one idea (§5.6): reward to risk, result, days held, conviction. */
export function ideaCells(t: IdeaStatsInput): StatCell[] {
  const far = finalTarget(t);
  const r = resultR(t);
  const days = holdingDays(t);
  const openCaption: Record<TradeStatus, string> = {
    watching: 'Not triggered yet',
    active: t.triggered ? `Open since ${formatDateISO(t.triggered)}` : 'Open',
    closed: 'Closed',
    stopped: 'Stopped out',
    invalidated: 'Never triggered',
  };
  return [
    {
      label: 'Reward : risk',
      ...(far ? { value: far.r.toFixed(1), unit: ': 1' } : { value: EMPTY }),
      caption: far ? `To T${far.index + 1} at ${formatPrice(far.price)}` : 'No risk defined',
    },
    {
      label: 'Result',
      ...splitR(r),
      caption: r === null ? openCaption[t.status] : `Exit ${formatPrice(t.exit)} · ${formatPct(resultPct(t))}`,
    },
    {
      label: 'Held',
      ...(days === null ? { value: EMPTY } : { value: String(days), unit: days === 1 ? 'day' : 'days' }),
      caption: days === null ? openCaption[t.status] : t.triggered ? 'Trigger to close' : 'Logged to close',
    },
    {
      label: 'Conviction',
      ...(t.conviction ? { value: String(t.conviction), unit: '/ 5' } : { value: EMPTY }),
      caption: 'Self-rated, 1 to 5',
    },
  ];
}

/* ------------------------------------------------------------------ levels ---- */

export interface LevelCell {
  price: string;
  /** Signed % move from entry; absent for the entry itself. */
  pct?: string;
}

/** The card's levels: entry, stop (with its % move) and every target (with theirs). */
export function levelCells(t: TradeLevels & Pick<TradeLike, 'targets'>): { entry: LevelCell; stop: LevelCell; targets: LevelCell[] } {
  const cell = (price: number): LevelCell => ({ price: formatPrice(price), pct: formatPct(pctMove(t, price)) });
  return { entry: { price: formatPrice(t.entry) }, stop: cell(t.stop), targets: t.targets.map(cell) };
}

/** TradingView's page for a symbol, for the no-script link: NASDAQ:NVDA → /symbols/NASDAQ-NVDA/. */
export function tradingViewUrl(symbol: string): string {
  return `https://www.tradingview.com/symbols/${encodeURIComponent(symbol.replace(':', '-'))}/`;
}
