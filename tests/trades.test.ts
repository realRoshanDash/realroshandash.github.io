import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  compareTrades,
  computeStats,
  holdingDays,
  pctMove,
  resultPct,
  resultR,
  riskPerShare,
  rMultiple,
  statusMeta,
  targetsWithR,
  tradeSynopsis,
  tvSymbol,
  type TradeLike,
  type TradeStats,
  type TradeStatus,
} from '../src/lib/trades.ts';

const MINUS = String.fromCharCode(0x2212);

function near(actual: number | null, expected: number, epsilon = 1e-9) {
  assert.ok(actual !== null && Math.abs(actual - expected) < epsilon, `expected ≈ ${expected}, got ${actual}`);
}

/** A plain object in the shape of a trades entry's data — no Astro needed. */
function idea(overrides: Partial<TradeLike> = {}): TradeLike {
  return {
    direction: 'long',
    status: 'watching',
    entry: 100,
    stop: 90,
    targets: [120, 130],
    published: new Date('2026-11-02'),
    ...overrides,
  };
}

const nvda = idea({ entry: 182.5, stop: 174, targets: [199.5, 210] });
const tsla = idea({ direction: 'short', entry: 452, stop: 468, targets: [428, 404] });

describe('risk and R-multiples', () => {
  test('risk per share is |entry − stop| for either direction', () => {
    assert.equal(riskPerShare(nvda), 8.5);
    assert.equal(riskPerShare(tsla), 16);
  });

  test('a long gains R as price rises; a short as it falls', () => {
    near(rMultiple(nvda, 199.5), 2);
    near(rMultiple(nvda, 210), 27.5 / 8.5);
    near(rMultiple(nvda, 174), -1);
    near(rMultiple(tsla, 428), 1.5);
    near(rMultiple(tsla, 468), -1);
    near(rMultiple(tsla, 476), -1.5);
  });

  test('null without risk or a price, never NaN or Infinity', () => {
    assert.equal(rMultiple({ direction: 'long', entry: 50, stop: 50 }, 60), null);
    assert.equal(rMultiple(nvda, Number.NaN), null);
  });

  test('percentage move is signed by direction', () => {
    near(pctMove(nvda, 199.5), (17 / 182.5) * 100);
    near(pctMove(nvda, 174), (-8.5 / 182.5) * 100);
    near(pctMove(tsla, 421.6), (30.4 / 452) * 100);
    assert.equal(pctMove({ direction: 'long', entry: 0 }, 1), null);
  });

  test('targets carry their R and % move, in order', () => {
    const [first, second] = targetsWithR(tsla);
    assert.equal(first.price, 428);
    near(first.r, 1.5);
    near(first.pct, (24 / 452) * 100);
    assert.equal(second.price, 404);
    near(second.r, 3);
  });
});

describe('results', () => {
  test('closed and stopped ideas have a result', () => {
    near(resultR({ ...nvda, status: 'closed', exit: 195.2 }), 12.7 / 8.5);
    near(resultR({ ...tsla, status: 'closed', exit: 421.6 }), 1.9);
    near(resultPct({ ...tsla, status: 'closed', exit: 421.6 }), (30.4 / 452) * 100);
  });

  test('stopped at the stop is −1R; slippage makes it worse', () => {
    near(resultR({ ...nvda, status: 'stopped', exit: 174 }), -1);
    near(resultR({ ...tsla, status: 'stopped', exit: 468 }), -1);
    near(resultR({ ...nvda, status: 'stopped', exit: 172.3 }), -10.2 / 8.5);
  });

  test('open, invalidated or exit-less ideas have none', () => {
    for (const status of ['watching', 'active', 'invalidated'] as const) {
      assert.equal(resultR({ ...nvda, status, exit: 190 }), null, status);
      assert.equal(resultPct({ ...nvda, status, exit: 190 }), null, status);
    }
    assert.equal(resultR({ ...nvda, status: 'closed' }), null);
  });
});

describe('holdingDays', () => {
  test('closed − triggered, else closed − published', () => {
    assert.equal(holdingDays({ published: new Date('2026-10-19'), triggered: new Date('2026-10-20'), closed: new Date('2026-10-29') }), 9);
    assert.equal(holdingDays({ published: new Date('2026-10-19'), closed: new Date('2026-10-29') }), 10);
  });

  test('same day is 0; no close date is null; bad data never goes negative', () => {
    assert.equal(holdingDays({ published: new Date('2026-11-02'), closed: new Date('2026-11-02') }), 0);
    assert.equal(holdingDays({ published: new Date('2026-11-02') }), null);
    assert.equal(holdingDays({ published: new Date('2026-11-05'), closed: new Date('2026-11-02') }), 0);
  });
});

test('tvSymbol: override, else EXCHANGE:TICKER', () => {
  assert.equal(tvSymbol({ ticker: 'NVDA', exchange: 'NASDAQ' }), 'NASDAQ:NVDA');
  assert.equal(tvSymbol({ ticker: 'JPM', exchange: 'NYSE' }), 'NYSE:JPM');
  assert.equal(tvSymbol({ ticker: 'BTCUSD', exchange: 'NASDAQ', tvSymbol: 'BINANCE:BTCUSDT' }), 'BINANCE:BTCUSDT');
  assert.equal(tvSymbol({ ticker: 'BRK.B', exchange: 'NYSE', tvSymbol: '  ' }), 'NYSE:BRK.B');
});

describe('status', () => {
  test('labels and priority: active, watching, closed, stopped, invalidated', () => {
    const order: TradeStatus[] = ['active', 'watching', 'closed', 'stopped', 'invalidated'];
    assert.deepEqual(
      order.map((status) => statusMeta(status).priority),
      [0, 1, 2, 3, 4],
    );
    assert.equal(statusMeta('stopped').label, 'Stopped out');
    assert.deepEqual(
      order.map((status) => statusMeta(status).open),
      [true, true, false, false, false],
    );
  });

  test('compareTrades sorts by status, then newest first', () => {
    const trades = [
      idea({ status: 'closed', published: new Date('2026-10-01') }),
      idea({ status: 'invalidated', published: new Date('2026-11-01') }),
      idea({ status: 'active', published: new Date('2026-09-01') }),
      idea({ status: 'watching', published: new Date('2026-11-05') }),
      idea({ status: 'active', published: new Date('2026-10-15') }),
      idea({ status: 'stopped', published: new Date('2026-11-04') }),
    ];
    assert.deepEqual(
      trades.sort(compareTrades).map((t) => `${t.status} ${t.published.toISOString().slice(0, 10)}`),
      ['active 2026-10-15', 'active 2026-09-01', 'watching 2026-11-05', 'closed 2026-10-01', 'stopped 2026-11-04', 'invalidated 2026-11-01'],
    );
  });
});

describe('computeStats', () => {
  const assertFinite = (stats: TradeStats) => {
    for (const [key, value] of Object.entries(stats)) {
      assert.ok(value === null || Number.isFinite(value), `${key} is ${value}`);
    }
  };

  test('no decided ideas: zero counts, null ratios, never NaN or Infinity', () => {
    const empty = computeStats([]);
    assert.deepEqual(empty, {
      count: 0, wins: 0, losses: 0, breakeven: 0, winRate: null, totalR: 0, avgR: null, bestR: null,
      worstR: null, avgWinR: null, avgLossR: null, expectancy: null, profitFactor: null,
    });
    assert.deepEqual(computeStats([idea({ status: 'active' }), idea({ status: 'watching' })]), empty);
  });

  test('a mixed record', () => {
    const stats = computeStats([
      idea({ status: 'closed', exit: 120 }), // +2R
      idea({ status: 'stopped', exit: 90 }), // −1R
      idea({ direction: 'short', status: 'closed', entry: 50, stop: 55, targets: [40], exit: 42.5 }), // +1.5R
      idea({ status: 'closed', exit: 100 }), // 0R, breakeven
      idea({ status: 'stopped', exit: 88 }), // −1.2R, slippage
      idea({ status: 'active' }),
      idea({ status: 'watching' }),
      idea({ status: 'invalidated', exit: 95 }),
      idea({ status: 'closed' }), // no exit: not decided
    ]);
    assertFinite(stats);
    assert.equal(stats.count, 5);
    assert.equal(stats.wins, 2);
    assert.equal(stats.losses, 2);
    assert.equal(stats.breakeven, 1);
    near(stats.winRate, 40);
    near(stats.totalR, 1.3);
    near(stats.avgR, 0.26);
    near(stats.bestR, 2);
    near(stats.worstR, -1.2);
    near(stats.avgWinR, 1.75);
    near(stats.avgLossR, -1.1);
    near(stats.expectancy, 0.26);
    near(stats.profitFactor, 3.5 / 2.2);
  });

  test('wins only: profit factor is null rather than Infinity', () => {
    const stats = computeStats([idea({ status: 'closed', exit: 115 }), idea({ status: 'closed', exit: 130 })]);
    assertFinite(stats);
    near(stats.winRate, 100);
    assert.equal(stats.avgLossR, null);
    assert.equal(stats.profitFactor, null);
    near(stats.expectancy, 2.25);
  });

  test('losses only: profit factor 0, win rate 0', () => {
    const stats = computeStats([idea({ status: 'stopped', exit: 90 })]);
    assertFinite(stats);
    assert.equal(stats.winRate, 0);
    assert.equal(stats.profitFactor, 0);
    near(stats.expectancy, -1);
  });
});

describe('tradeSynopsis', () => {
  const base = { ticker: 'NVDA', setup: 'Breakout retest', timeframe: 'swing' as const };

  test('active long', () => {
    assert.equal(
      tradeSynopsis({ ...nvda, ...base, status: 'active', published: new Date('2026-11-02'), triggered: new Date('2026-11-03') }),
      'Long NVDA · Breakout retest · Swing. Entry 182.50, stop 174.00, targets 199.50 (+2.0R), 210.00 (+3.2R). Active since 3 Nov 2026.',
    );
  });

  test('closed short with result and holding period', () => {
    assert.equal(
      tradeSynopsis({
        ...tsla,
        ticker: 'TSLA',
        setup: 'Lower-high rejection',
        timeframe: 'swing',
        status: 'closed',
        exit: 421.6,
        published: new Date('2026-10-19'),
        triggered: new Date('2026-10-20'),
        closed: new Date('2026-10-29'),
      }),
      'Short TSLA · Lower-high rejection · Swing. Entry 452.00, stop 468.00, targets 428.00 (+1.5R), 404.00 (+3.0R). Closed at 421.60 on 29 Oct 2026: +1.9R (+6.7%) after 9 days.',
    );
  });

  test('stopped, watching and invalidated', () => {
    const stopped = tradeSynopsis({ ...nvda, ...base, status: 'stopped', exit: 174, triggered: new Date('2026-11-03'), closed: new Date('2026-11-06') });
    assert.ok(stopped.endsWith(`Stopped out at 174.00 on 6 Nov 2026: ${MINUS}1.0R (${MINUS}4.7%) after 3 days.`), stopped);

    const watching = tradeSynopsis({ ...base, ...idea({ entry: 312, stop: 297, targets: [342] }), ticker: 'JPM', timeframe: 'position' });
    assert.ok(watching.includes('Position. Entry 312.00, stop 297.00, target 342.00 (+2.0R).'), watching);
    assert.ok(watching.endsWith('Watching: not triggered yet.'), watching);

    assert.ok(tradeSynopsis({ ...nvda, ...base, status: 'invalidated' }).endsWith('Invalidated: never triggered.'));
  });
});
