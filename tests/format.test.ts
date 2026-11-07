import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EMPTY,
  formatDate,
  formatDateISO,
  formatDuration,
  formatPct,
  formatPrice,
  formatR,
  pluralize,
  relativeTime,
} from '../src/lib/format.ts';

const MINUS = String.fromCharCode(0x2212);

describe('formatPrice', () => {
  test('two decimals with thousands separators', () => {
    assert.equal(formatPrice(182.5), '182.50');
    assert.equal(formatPrice(1234.5), '1,234.50');
    assert.equal(formatPrice(1_234_567.891), '1,234,567.89');
    assert.equal(formatPrice(1), '1.00');
    assert.equal(formatPrice(0), '0.00');
  });

  test('four decimals under 1', () => {
    assert.equal(formatPrice(0.4321), '0.4321');
    assert.equal(formatPrice(0.5), '0.5000');
    assert.equal(formatPrice(0.00012), '0.0001');
  });

  test('missing or non-finite values render as an em dash', () => {
    for (const value of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatPrice(value), EMPTY);
  });
});

describe('formatR', () => {
  test('signed, one decimal, real minus sign', () => {
    assert.equal(formatR(1.84), '+1.8R');
    assert.equal(formatR(3.235), '+3.2R');
    assert.equal(formatR(-1), `${MINUS}1.0R`);
    assert.ok(!formatR(-2.5).includes('-'), 'no hyphen-minus');
  });

  test('zero, and values that round to zero, carry no sign', () => {
    assert.equal(formatR(0), '0.0R');
    assert.equal(formatR(-0), '0.0R');
    assert.equal(formatR(0.04), '0.0R');
    assert.equal(formatR(-0.04), '0.0R');
  });

  test('digits and missing values', () => {
    assert.equal(formatR(1.256, 2), '+1.26R');
    assert.equal(formatR(null), EMPTY);
    assert.equal(formatR(Number.NaN), EMPTY);
  });
});

describe('formatPct', () => {
  test('signed, one decimal', () => {
    assert.equal(formatPct(5.234), '+5.2%');
    assert.equal(formatPct(-3.46), `${MINUS}3.5%`);
    assert.equal(formatPct(0), '0.0%');
  });

  test('unsigned for rates; missing values', () => {
    assert.equal(formatPct(62.5, { signed: false }), '62.5%');
    assert.equal(formatPct(100 / 3, { signed: false, digits: 0 }), '33%');
    assert.equal(formatPct(undefined), EMPTY);
  });
});

describe('formatDate / formatDateISO', () => {
  test('date-only frontmatter (UTC midnight) renders as that calendar day', () => {
    assert.equal(formatDate(new Date('2026-11-07')), '7 Nov 2026');
    assert.equal(formatDate(new Date('2026-01-01')), '1 Jan 2026');
    assert.equal(formatDate(new Date('2026-12-31')), '31 Dec 2026');
    assert.equal(formatDate('2026-11-07'), '7 Nov 2026');
    assert.equal(formatDateISO(new Date('2026-11-07')), '2026-11-07');
    assert.equal(formatDateISO(new Date('2026-01-01')), '2026-01-01');
  });

  test('instants fall on the Singapore calendar day', () => {
    assert.equal(formatDate(new Date('2026-11-07T15:59:59Z')), '7 Nov 2026'); // 23:59:59 SGT
    assert.equal(formatDate(new Date('2026-11-07T16:00:00Z')), '8 Nov 2026'); // 00:00 SGT
    assert.equal(formatDateISO(new Date('2026-03-01T17:00:00Z')), '2026-03-02');
  });

  test("the build machine's time zone makes no difference", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        assert.equal(formatDate(new Date('2026-11-07')), '7 Nov 2026', tz);
        assert.equal(formatDateISO(new Date('2026-11-07')), '2026-11-07', tz);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  test('invalid dates', () => {
    assert.equal(formatDate('not a date'), EMPTY);
    assert.equal(formatDateISO('not a date'), '');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-11-07T10:00:00+08:00');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  test('under a day counts elapsed time', () => {
    assert.equal(relativeTime(ago(20_000), now), 'now');
    assert.equal(relativeTime(ago(90_000), now), '1 minute ago');
    assert.equal(relativeTime(ago(5 * 60_000), now), '5 minutes ago');
    assert.equal(relativeTime(ago(-3 * 3_600_000), now), 'in 3 hours');
    assert.equal(relativeTime(ago(23.9 * 3_600_000), now), '23 hours ago');
  });

  test('from a day on counts Singapore calendar days', () => {
    assert.equal(relativeTime(new Date('2026-11-06'), now), 'yesterday');
    assert.equal(relativeTime(new Date('2026-11-04'), now), '3 days ago');
    assert.equal(relativeTime(new Date('2026-10-30'), now), 'last week');
    assert.equal(relativeTime(new Date('2026-10-17'), now), '3 weeks ago');
    assert.equal(relativeTime(new Date('2026-09-01'), now), '2 months ago');
    assert.equal(relativeTime(new Date('2025-11-07'), now), 'last year');
    assert.equal(relativeTime(new Date('2021-09-08'), now), '5 years ago');
    assert.equal(relativeTime(new Date('2026-11-09'), now), 'in 2 days');
  });

  test('invalid dates', () => assert.equal(relativeTime('soon', now), EMPTY));
});

describe('formatDuration', () => {
  test('two largest units, rounded down', () => {
    assert.equal(formatDuration((3 * 60 + 12) * 60_000 + 59_000), '3h 12m');
    assert.equal(formatDuration((2 * 24 + 4) * 3_600_000 + 59 * 60_000), '2d 4h');
    assert.equal(formatDuration(24 * 3_600_000), '1d');
    assert.equal(formatDuration(3_600_000), '1h');
    assert.equal(formatDuration(12 * 60_000 + 30_000), '12m');
    assert.equal(formatDuration(45_000), '45s');
    assert.equal(formatDuration(-5_000), '0s');
  });
});

describe('pluralize', () => {
  test('count and noun', () => {
    assert.equal(pluralize(1, 'day'), '1 day');
    assert.equal(pluralize(0, 'idea'), '0 ideas');
    assert.equal(pluralize(9, 'day'), '9 days');
    assert.equal(pluralize(2, 'entry', 'entries'), '2 entries');
    assert.equal(pluralize(1234, 'word'), '1,234 words');
  });
});
