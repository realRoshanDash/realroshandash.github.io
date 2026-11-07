/**
 * View models of the dormant notes and trade-ideas sections: the price ladder's geometry and label spreading,
 * the card's R-bar, the update log, the stats cells, and how links are shown.
 * Run: node --test tests/dormant-sections.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  finalTarget,
  ideaCells,
  ladderLabel,
  ladderModel,
  LABEL_GAP,
  planSentence,
  rBarModel,
  spreadLabels,
  trackRecordCells,
  tradeLog,
  tradeNumber,
  tradingViewUrl,
  type LogInput,
} from '../src/components/trades/model.ts';
import { displayUrl } from '../src/components/notes/display.ts';

const MINUS = String.fromCharCode(0x2212);
const close = (actual: number, expected: number, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ≈ ${expected}, got ${actual}`);

/** The three seeded examples, as plain frontmatter objects. */
const nvda: LogInput & { conviction?: number } = {
  direction: 'long',
  status: 'active',
  entry: 182.5,
  stop: 174,
  targets: [199.5, 210],
  published: new Date('2026-11-02'),
  triggered: new Date('2026-11-03'),
  conviction: 3,
  updates: [
    { date: new Date('2026-11-03'), note: 'Triggered on the first push off the retest.' },
    { date: new Date('2026-11-06'), note: 'Holding above the breakout level.' },
  ],
};
const tsla: LogInput & { conviction?: number } = {
  direction: 'short',
  status: 'closed',
  entry: 452,
  stop: 468,
  targets: [428, 404],
  exit: 421.6,
  published: new Date('2026-10-19'),
  triggered: new Date('2026-10-20'),
  closed: new Date('2026-10-29'),
  conviction: 4,
  updates: [
    { date: new Date('2026-10-20'), note: 'Filled at 452.00.' },
    { date: new Date('2026-10-23'), note: 'First target reached; covered half.' },
    { date: new Date('2026-10-29'), note: 'Covered the rest at 415.20.' },
  ],
};
const jpm: LogInput = {
  direction: 'long',
  status: 'watching',
  entry: 312,
  stop: 297,
  targets: [342, 357],
  published: new Date('2026-11-06'),
  updates: [],
};

describe('price ladder', () => {
  test('a long: targets on top, then entry and stop; y on a range padded by 8%', () => {
    const model = ladderModel(nvda);
    assert.deepEqual(model.levels.map((l) => l.name), ['T2', 'T1', 'Entry', 'Stop']);
    // range 171.12 – 212.88
    close(model.levels[0].y, (2.88 / 41.76) * 100);
    close(model.levels[2].y, (30.38 / 41.76) * 100);
    close(model.levels[3].y, (38.88 / 41.76) * 100);
    assert.deepEqual(model.levels.map((l) => l.labelY), model.levels.map((l) => l.y)); // nothing crowded
    assert.equal(model.oneR, 8.5);
    close(model.levels[0].r ?? NaN, 27.5 / 8.5);
    assert.equal(model.levels[2].r, 0);
    assert.equal(model.levels[3].r, -1);
  });

  test('risk and reward zones, and a tick every R inside the plot, top down', () => {
    const model = ladderModel(nvda);
    close(model.risk.top, model.levels[2].y);
    close(model.risk.bottom, model.levels[3].y);
    close(model.reward.top, model.levels[0].y);
    close(model.reward.bottom, model.levels[2].y);
    assert.deepEqual(model.ticks.map((t) => t.r), [3, 2, 1, 0, -1]);
    close(model.ticks[0].y, (4.88 / 41.76) * 100); // 3R = 208.00
  });

  test('a short is upside down: stop on top, targets below, and the exit once closed', () => {
    const model = ladderModel(tsla);
    assert.deepEqual(model.levels.map((l) => l.name), ['Stop', 'Entry', 'T1', 'Exit', 'T2']);
    const exit = model.levels.find((l) => l.kind === 'exit');
    close(exit?.r ?? NaN, 1.9);
    // no exit level while the idea is open
    assert.ok(!ladderModel(nvda).levels.some((l) => l.kind === 'exit'));
  });

  test('crowded labels are pushed apart, keep their order, and their level keeps its true y', () => {
    const model = ladderModel({ direction: 'long', status: 'active', entry: 100, stop: 90, targets: [101, 120] });
    const names = model.levels.map((l) => l.name);
    assert.deepEqual(names, ['T2', 'T1', 'Entry', 'Stop']);
    const [, t1, entry] = model.levels;
    close(entry.y, (22.4 / 34.8) * 100);
    close(entry.labelY, t1.labelY + LABEL_GAP);
    for (let i = 1; i < model.levels.length; i++) {
      assert.ok(model.levels[i].labelY - model.levels[i - 1].labelY >= LABEL_GAP - 1e-9);
    }
  });

  test('spreading stays inside the plot, pushing back up from the bottom edge', () => {
    const levels = [{ labelY: 95 }, { labelY: 96 }, { labelY: 97 }];
    spreadLabels(levels, 7, 3.5, 96.5);
    assert.deepEqual(levels.map((l) => l.labelY), [82.5, 89.5, 96.5]);
    const top = [{ labelY: 0 }, { labelY: 1 }];
    spreadLabels(top, 7, 3.5, 96.5);
    assert.deepEqual(top.map((l) => l.labelY), [3.5, 10.5]);
  });

  test('the spoken label lists every level, highest first', () => {
    assert.equal(
      ladderLabel(ladderModel(nvda)),
      `Price levels, highest first: Target 2 210.00, +3.2R; Target 1 199.50, +2.0R; Entry 182.50; Stop 174.00, ${MINUS}1.0R. 1R is 8.50.`,
    );
  });
});

describe('R-bar', () => {
  test('open idea: risk −1R → 0 against the furthest target', () => {
    const bar = rBarModel(nvda);
    assert.ok(bar);
    assert.equal(bar.stop, 0);
    close(bar.entry, (1 / (1 + 27.5 / 8.5)) * 100);
    assert.equal(bar.target, 100);
    assert.equal(bar.exit, null);
    assert.equal(bar.label, 'Risk 1R against a 3.2R target.');
  });

  test('closed idea: the exit sits at its R, and the label says how it ended', () => {
    const bar = rBarModel(tsla);
    assert.ok(bar);
    assert.equal(bar.entry, 25);
    close(bar.exit ?? NaN, 72.5);
    assert.equal(bar.label, 'Risk 1R against a 3.0R target; closed at +1.9R.');
  });

  test('a loss beyond the stop widens the bar instead of overflowing it', () => {
    const bar = rBarModel({ ...nvda, status: 'stopped', exit: 170.75 }); // −1.38R
    assert.ok(bar);
    assert.equal(bar.exit, 0);
    assert.ok(bar.stop > 0 && bar.stop < bar.entry);
    assert.match(bar.label, /stopped out at −1\.4R\.$/);
  });

  test('the furthest target is the last to be reached, whatever the frontmatter order', () => {
    assert.deepEqual(finalTarget({ direction: 'short', entry: 452, stop: 468, targets: [404, 428] }), { index: 0, price: 404, r: 3 });
    assert.equal(finalTarget({ direction: 'long', entry: 50, stop: 50, targets: [60] }), null);
  });
});

describe('update log', () => {
  test('logged, triggered and updates, oldest first; the trigger-day update becomes the trigger text', () => {
    const log = tradeLog(nvda);
    assert.deepEqual(
      log.map((e) => [e.kind, e.day, e.title]),
      [
        ['published', 0, 'Idea logged'],
        ['triggered', 1, 'Triggered at 182.50'],
        ['update', 4, 'Update'],
      ],
    );
    assert.equal(log[0].text, 'Entry 182.50, stop 174.00, targets 199.50 and 210.00.');
    assert.equal(log[1].text, 'Triggered on the first push off the retest.');
    assert.equal(log[2].text, 'Holding above the breakout level.');
  });

  test('a closed idea ends with its result; same-day notes are never repeated', () => {
    const log = tradeLog(tsla);
    assert.deepEqual(
      log.map((e) => [e.kind, e.day]),
      [
        ['published', 0],
        ['triggered', 1],
        ['update', 4],
        ['closed', 10],
      ],
    );
    assert.equal(log[3].title, 'Closed at 421.60 · +1.9R');
    assert.equal(log[3].text, 'Covered the rest at 415.20.');
    assert.equal(log.filter((e) => e.text === 'Filled at 452.00.').length, 1);
  });

  test('watching, stopped and invalidated ideas', () => {
    assert.deepEqual(tradeLog(jpm).map((e) => e.kind), ['published']);
    const stopped = tradeLog({ ...nvda, status: 'stopped', exit: 174, closed: new Date('2026-11-05'), updates: [] });
    assert.equal(stopped.at(-1)?.title, `Stopped out at 174.00 · ${MINUS}1.0R`);
    const invalidated = tradeLog({ ...jpm, status: 'invalidated', updated: new Date('2026-11-20') });
    assert.deepEqual(invalidated.map((e) => [e.kind, e.day, e.title]), [
      ['published', 0, 'Idea logged'],
      ['invalidated', 14, 'Invalidated: never triggered'],
    ]);
  });

  test('plan sentence: one, two or more targets', () => {
    assert.equal(planSentence({ entry: 100, stop: 90, targets: [120] }), 'Entry 100.00, stop 90.00, target 120.00.');
    assert.equal(planSentence({ entry: 100, stop: 90, targets: [110, 120, 130] }), 'Entry 100.00, stop 90.00, targets 110.00, 120.00 and 130.00.');
  });
});

describe('stats cells', () => {
  test('track record: decided ideas only; open ones are counted apart', () => {
    const cells = trackRecordCells([nvda, jpm, tsla]);
    assert.deepEqual(cells.map((c) => [c.label, c.value, c.unit ?? '', c.caption]), [
      ['Win rate', '100', '%', '1 of 1 closed'],
      ['Avg R', '+1.90', 'R', 'Per closed idea, equal risk'],
      ['Closed ideas', '1', '', 'Closed or stopped out'],
      ['Open', '2', '', 'Active or watching'],
    ]);
  });

  test('track record with nothing decided: an en dash means no value', () => {
    const cells = trackRecordCells([jpm]);
    assert.equal(cells[0].value, '—');
    assert.equal(cells[0].unit, undefined);
    assert.equal(cells[0].caption, 'No closed ideas yet');
    assert.equal(cells[1].value, '—');
  });

  test('one idea: reward to risk, result, days held, conviction', () => {
    assert.deepEqual(ideaCells(tsla).map((c) => [c.value, c.unit ?? '', c.caption]), [
      ['3.0', ': 1', 'To T2 at 404.00'],
      ['+1.9', 'R', 'Exit 421.60 · +6.7%'],
      ['9', 'days', 'Trigger to close'],
      ['4', '/ 5', 'Self-rated, 1 to 5'],
    ]);
    assert.deepEqual(ideaCells(nvda).slice(1, 3).map((c) => [c.value, c.caption]), [
      ['—', 'Open since 2026-11-03'],
      ['—', 'Open since 2026-11-03'],
    ]);
    assert.equal(ideaCells(jpm)[3].value, '—');
  });
});

describe('numbering', () => {
  test('an idea has one number, oldest first, whatever order the page lists it in (same-day ideas included)', () => {
    // getTrades(): newest first, ties by id — AAPL and JPM were both published on 2026-11-06
    const newestFirst = [{ id: 'aapl-same-day' }, { id: 'jpm-flat-base' }, { id: 'nvda-breakout' }, { id: 'tsla-short' }];
    const byStatus = [newestFirst[2], newestFirst[0], newestFirst[3], newestFirst[1]]; // the index's card order
    const numbers = Object.fromEntries(byStatus.map((t) => [t.id, tradeNumber(newestFirst, t.id)]));
    assert.deepEqual(numbers, { 'nvda-breakout': 2, 'aapl-same-day': 4, 'tsla-short': 1, 'jpm-flat-base': 3 });
    assert.equal(tradeNumber(newestFirst, 'missing'), 0);
  });
});

describe('links', () => {
  test('displayUrl reads like the link, and stays short', () => {
    assert.equal(displayUrl('https://www.example.com/docs/guide/'), 'example.com/docs/guide');
    assert.equal(displayUrl('https://example.com/'), 'example.com');
    assert.equal(displayUrl('https://example.com/a/b/?q=1#x'), 'example.com/a/b');
    assert.equal(
      displayUrl('https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:where'),
      'developer.mozilla.org/en-US/docs/Web/CSS/…',
    );
    assert.ok(displayUrl('https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:where').length <= 48);
    assert.equal(displayUrl('not a url'), 'not a url');
  });

  test('displayUrl decodes what it can and never throws on a malformed escape', () => {
    assert.equal(displayUrl('https://example.com/caf%C3%A9'), 'example.com/café');
    // URIError from decodeURI used to fail the whole build for one published note
    assert.equal(displayUrl('https://example.com/100%'), 'example.com/100%');
    assert.equal(displayUrl('https://en.wikipedia.org/wiki/100%_(album)'), 'en.wikipedia.org/wiki/100%_(album)');
    assert.equal(displayUrl('https://example.com/%zz/%E9'), 'example.com/%zz/%E9');
  });

  test('TradingView symbol pages', () => {
    assert.equal(tradingViewUrl('NASDAQ:NVDA'), 'https://www.tradingview.com/symbols/NASDAQ-NVDA/');
    assert.equal(tradingViewUrl('NYSE:BRK.B'), 'https://www.tradingview.com/symbols/NYSE-BRK.B/');
  });
});
