import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CALENDAR_YEARS,
  EARLY_CLOSES,
  HOLIDAYS,
  NEW_YORK,
  formatET,
  formatSGT,
  marketClock,
  marketDay,
  wallClock,
  type MarketClock,
  type Sessions,
} from '../src/lib/market-clock.ts';

/** Assert selected fields of marketClock(now); Dates are compared as ISO strings. */
function expectClock(now: string, expected: Partial<Record<keyof MarketClock, string | boolean | undefined>>): MarketClock {
  const clock = marketClock(new Date(now));
  for (const [key, value] of Object.entries(expected)) {
    const actual = clock[key as keyof MarketClock];
    assert.equal(actual instanceof Date ? actual.toISOString() : actual, value, `${now} → ${key}`);
  }
  return clock;
}

function sessions(date: string): Sessions {
  const day = marketDay(date);
  assert.ok(day.sessions, `${date} should be a trading day`);
  return day.sessions;
}

describe('a normal trading day (Tue 10 Nov 2026, New York on EST, UTC−5)', () => {
  test('overnight → pre-market → open → post-market → overnight; starts inclusive', () => {
    expectClock('2026-11-10T08:59:59Z', {
      phase: 'closed', reason: 'overnight', nextChange: '2026-11-10T09:00:00.000Z', nextPhase: 'pre', nextOpen: '2026-11-10T14:30:00.000Z',
    });
    expectClock('2026-11-10T09:00:00Z', { phase: 'pre', reason: undefined, nextChange: '2026-11-10T14:30:00.000Z', nextPhase: 'open' });
    expectClock('2026-11-10T14:29:59Z', { phase: 'pre' });
    expectClock('2026-11-10T14:30:00Z', {
      phase: 'open', earlyClose: false, nextChange: '2026-11-10T21:00:00.000Z', nextPhase: 'post', nextOpen: '2026-11-11T14:30:00.000Z',
    });
    expectClock('2026-11-10T21:00:00Z', { phase: 'post', nextChange: '2026-11-11T01:00:00.000Z', nextPhase: 'closed' });
    expectClock('2026-11-11T01:00:00Z', { phase: 'closed', reason: 'overnight', nextChange: '2026-11-11T09:00:00.000Z', nextPhase: 'pre' });
  });

  test('reads 22:30 – 05:00 in Singapore', () => {
    const { regular, pre, post } = sessions('2026-11-10');
    assert.equal(formatSGT(pre.start), '17:00 SGT');
    assert.equal(formatSGT(regular.start), '22:30 SGT');
    assert.equal(formatSGT(regular.end, { weekday: true }), 'Wed 05:00 SGT');
    assert.equal(formatSGT(post.end, { weekday: true }), 'Wed 09:00 SGT');
    assert.equal(formatET(regular.start, { weekday: true }), 'Tue 09:30 ET');
  });
});

describe('daylight saving (US: 2nd Sunday of March to 1st Sunday of November)', () => {
  test('DST starts Sun 8 Mar 2026: the Singapore open moves from 22:30 to 21:30', () => {
    expectClock('2026-03-06T12:00:00Z', { phase: 'pre', nextChange: '2026-03-06T14:30:00.000Z', nextPhase: 'open' });
    assert.equal(formatSGT(sessions('2026-03-06').regular.start), '22:30 SGT');

    // The weekend in between must already use EDT (UTC−4) for Monday.
    const weekend = expectClock('2026-03-07T12:00:00Z', {
      phase: 'closed', reason: 'weekend', nextChange: '2026-03-09T08:00:00.000Z', nextPhase: 'pre', nextOpen: '2026-03-09T13:30:00.000Z',
    });
    assert.equal(formatET(weekend.nextChange), '04:00 ET');
    assert.equal(formatSGT(weekend.nextOpen, { weekday: true }), 'Mon 21:30 SGT');

    expectClock('2026-03-09T13:30:00Z', { phase: 'open', nextChange: '2026-03-09T20:00:00.000Z' });
    expectClock('2026-03-09T20:00:00Z', { phase: 'post', nextChange: '2026-03-10T00:00:00.000Z' });
  });

  test('DST ends Sun 1 Nov 2026: the Singapore open moves from 21:30 back to 22:30', () => {
    const friday = sessions('2026-10-30');
    assert.equal(friday.regular.start.toISOString(), '2026-10-30T13:30:00.000Z');
    assert.equal(formatSGT(friday.regular.start), '21:30 SGT');
    assert.equal(formatSGT(friday.regular.end, { weekday: true }), 'Sat 04:00 SGT');

    const weekend = expectClock('2026-10-31T12:00:00Z', {
      phase: 'closed', reason: 'weekend', nextChange: '2026-11-02T09:00:00.000Z', nextOpen: '2026-11-02T14:30:00.000Z',
    });
    assert.equal(formatSGT(weekend.nextOpen), '22:30 SGT');
  });

  test('DST in 2027 and 2028 (14 Mar – 7 Nov 2027, 12 Mar – 5 Nov 2028)', () => {
    assert.equal(sessions('2027-03-12').regular.start.toISOString(), '2027-03-12T14:30:00.000Z');
    assert.equal(sessions('2027-03-15').regular.start.toISOString(), '2027-03-15T13:30:00.000Z');
    assert.equal(sessions('2028-11-03').regular.start.toISOString(), '2028-11-03T13:30:00.000Z');
    assert.equal(sessions('2028-11-06').regular.start.toISOString(), '2028-11-06T14:30:00.000Z');
  });
});

describe('holidays', () => {
  test('Thanksgiving: closed all day, next session is Friday pre-market', () => {
    expectClock('2026-11-26T15:00:00Z', {
      phase: 'closed', reason: 'holiday', holidayName: 'Thanksgiving Day', earlyClose: false,
      nextChange: '2026-11-27T09:00:00.000Z', nextPhase: 'pre', nextOpen: '2026-11-27T14:30:00.000Z',
    });
    // Wednesday night already rolls over the holiday.
    expectClock('2026-11-26T02:00:00Z', { phase: 'closed', reason: 'overnight', nextChange: '2026-11-27T09:00:00.000Z' });
  });

  test('observed holidays and long weekends', () => {
    expectClock('2026-07-03T15:00:00Z', { reason: 'holiday', holidayName: 'Independence Day (observed)' });
    expectClock('2027-03-26T15:00:00Z', { reason: 'holiday', holidayName: 'Good Friday' });
    expectClock('2027-12-24T15:00:00Z', { reason: 'holiday', holidayName: 'Christmas Day (observed)' });
    // MLK Day 2027 is Monday 18 Jan: Saturday's next session is Tuesday.
    expectClock('2027-01-16T15:00:00Z', { reason: 'weekend', nextChange: '2027-01-19T09:00:00.000Z' });
  });

  test("New Year's Day 2028 is a Saturday and not observed", () => {
    const eve = marketDay('2027-12-31');
    assert.equal(eve.status, 'trading');
    assert.equal(eve.earlyClose, false);
    assert.equal(eve.sessions?.regular.end.toISOString(), '2027-12-31T21:00:00.000Z');
    assert.equal(marketDay('2028-01-01').status, 'weekend');
  });
});

describe('early closes (13:00 regular close, late trading until 17:00 New York)', () => {
  test('day after Thanksgiving 2026', () => {
    expectClock('2026-11-27T17:00:00Z', { phase: 'open', earlyClose: true, nextChange: '2026-11-27T18:00:00.000Z', nextPhase: 'post' });
    expectClock('2026-11-27T19:00:00Z', { phase: 'post', earlyClose: true, nextChange: '2026-11-27T22:00:00.000Z', nextPhase: 'closed' });
    expectClock('2026-11-27T22:30:00Z', {
      phase: 'closed', reason: 'overnight', earlyClose: true, nextChange: '2026-11-30T09:00:00.000Z', nextPhase: 'pre',
    });
  });

  test('Christmas Eve 2026 closes 02:00 Friday in Singapore; Christmas Day rolls to Monday', () => {
    const eve = sessions('2026-12-24');
    assert.equal(formatSGT(eve.regular.end, { weekday: true }), 'Fri 02:00 SGT');
    assert.equal(formatET(eve.post.end), '17:00 ET');
    expectClock('2026-12-24T23:00:00Z', { phase: 'closed', reason: 'overnight', nextChange: '2026-12-28T09:00:00.000Z' });
  });

  test('3 Jul 2028 is an early close on daylight time', () => {
    const day = sessions('2028-07-03');
    assert.equal(day.regular.end.toISOString(), '2028-07-03T17:00:00.000Z');
    assert.equal(day.post.end.toISOString(), '2028-07-03T21:00:00.000Z');
    assert.equal(marketDay('2028-07-04').holidayName, 'Independence Day');
  });
});

describe('weekends and the Friday post-market → Monday pre-market rollover', () => {
  test('Friday 6 Nov 2026 evening to Monday 9 Nov', () => {
    expectClock('2026-11-07T00:30:00Z', { phase: 'post', nextChange: '2026-11-07T01:00:00.000Z', nextPhase: 'closed' });
    const friday = expectClock('2026-11-07T01:00:00Z', {
      phase: 'closed', reason: 'overnight', nextChange: '2026-11-09T09:00:00.000Z', nextPhase: 'pre', nextOpen: '2026-11-09T14:30:00.000Z',
    });
    assert.equal(formatSGT(friday.nextChange, { weekday: true }), 'Mon 17:00 SGT');
    assert.equal(formatSGT(friday.nextOpen, { weekday: true }), 'Mon 22:30 SGT');

    for (const now of ['2026-11-07T07:00:00Z', '2026-11-08T23:59:59Z', '2026-11-09T04:59:59Z']) {
      expectClock(now, { phase: 'closed', reason: 'weekend', nextChange: '2026-11-09T09:00:00.000Z', nextPhase: 'pre' });
    }
    expectClock('2026-11-09T05:00:00Z', { phase: 'closed', reason: 'overnight', nextChange: '2026-11-09T09:00:00.000Z' });
    expectClock('2026-11-09T09:00:00Z', { phase: 'pre', nextPhase: 'open' });
  });
});

describe('the whole 2026–2028 calendar', () => {
  test('every phase change chains into the next, opens at 09:30 New York, 251 sessions a year', () => {
    const opens: Record<number, number> = {};
    const earlyCloses: Record<number, number> = {};
    let now = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2028-12-30T00:00:00Z');
    while (now < end) {
      const clock = marketClock(now);
      assert.ok(clock.nextChange > now, `${now.toISOString()} → ${clock.nextChange.toISOString()}`);
      assert.ok(clock.nextOpen > now);
      const next = marketClock(clock.nextChange);
      assert.equal(next.phase, clock.nextPhase, `phase after ${clock.nextChange.toISOString()}`);

      const ny = wallClock(clock.nextChange, NEW_YORK);
      if (next.phase === 'open') {
        assert.deepEqual([ny.hour, ny.minute], [9, 30], clock.nextChange.toISOString());
        opens[ny.year] = (opens[ny.year] ?? 0) + 1;
      }
      if (next.phase === 'post' && ny.hour === 13) earlyCloses[ny.year] = (earlyCloses[ny.year] ?? 0) + 1;
      now = clock.nextChange;
    }
    assert.deepEqual(opens, { 2026: 251, 2027: 251, 2028: 251 });
    assert.deepEqual(earlyCloses, { 2026: 2, 2027: 1, 2028: 2 });
  });

  test('calendar data: weekdays only, no overlaps, expected counts', () => {
    const years = CALENDAR_YEARS as readonly number[];
    for (const date of [...Object.keys(HOLIDAYS), ...Object.keys(EARLY_CLOSES)]) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      assert.ok(weekday >= 1 && weekday <= 5, `${date} is a weekday`);
      assert.ok(years.includes(Number(date.slice(0, 4))), `${date} is within CALENDAR_YEARS`);
      assert.ok(!(date in HOLIDAYS && date in EARLY_CLOSES), `${date} is not both`);
    }
    const perYear = (dates: string[]) =>
      dates.reduce<Record<string, number>>((counts, date) => ({ ...counts, [date.slice(0, 4)]: (counts[date.slice(0, 4)] ?? 0) + 1 }), {});
    assert.deepEqual(perYear(Object.keys(HOLIDAYS)), { 2026: 10, 2027: 10, 2028: 9 });
    assert.deepEqual(perYear(Object.keys(EARLY_CLOSES)), { 2026: 2, 2027: 1, 2028: 2 });
  });
});

describe('time helpers', () => {
  test('formatSGT / formatET', () => {
    assert.equal(formatSGT(new Date('2026-11-09T14:30:00Z')), '22:30 SGT');
    assert.equal(formatSGT(new Date('2026-11-09T16:00:00Z')), '00:00 SGT');
    assert.equal(formatSGT(new Date('2026-11-09T21:00:00Z'), { weekday: true }), 'Tue 05:00 SGT');
    assert.equal(formatET(new Date('2026-07-01T13:30:00Z')), '09:30 ET');
    assert.equal(formatET(new Date('2026-12-01T14:30:00Z'), { weekday: true }), 'Tue 09:30 ET');
  });

  test('marketDay accepts an instant or a New York date', () => {
    assert.equal(marketDay(new Date('2026-11-27T02:00:00Z')).date, '2026-11-26'); // 21:00 Thursday in New York
    assert.equal(marketDay('2026-11-26').status, 'holiday');
    assert.throws(() => marketDay('26/11/2026'), RangeError);
    assert.throws(() => marketDay('2026-02-30'), RangeError);
  });

  test('defaults to now', () => {
    assert.ok(['pre', 'open', 'post', 'closed'].includes(marketClock().phase));
  });
});
