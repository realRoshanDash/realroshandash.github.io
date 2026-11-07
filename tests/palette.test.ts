import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { displayRoute, highlight, isApplePlatform, matchEntry, mergeRanges, resultCount } from '../src/lib/palette.ts';

describe('matchEntry', () => {
  test('ranks a label prefix over a word start over a match inside a word', () => {
    const prefix = matchEntry('wri', 'Writing');
    const word = matchEntry('theme', 'Switch to light theme');
    const inside = matchEntry('rit', 'Writing');
    assert.ok(prefix && word && inside);
    assert.ok(prefix.score > word.score && word.score > inside.score, `${prefix.score} > ${word.score} > ${inside.score}`);
  });

  test('returns the label range to highlight', () => {
    assert.deepEqual(matchEntry('theme', 'Switch to light theme')?.ranges, [[16, 21]]);
    assert.deepEqual(matchEntry('Home', 'Home')?.ranges, [[0, 4]]);
  });

  test('every word must match; order does not matter', () => {
    assert.ok(matchEntry('light switch', 'Switch to light theme'));
    assert.equal(matchEntry('light grid', 'Switch to light theme'), null);
  });

  test('a phrase starting a word scores above the same words apart', () => {
    const phrase = matchEntry('layout grid', 'Toggle layout grid');
    const apart = matchEntry('toggle grid', 'Toggle layout grid');
    assert.ok(phrase && apart && phrase.score > apart.score);
  });

  test('falls back to keywords, more weakly and without highlighting', () => {
    const viaKeyword = matchEntry('email', 'Contact', ['email', 'mail']);
    assert.ok(viaKeyword);
    assert.deepEqual(viaKeyword.ranges, []);
    assert.ok(viaKeyword.score < (matchEntry('cont', 'Contact')?.score ?? 0));
    assert.ok(matchEntry('guwa', 'About', ['IIT Guwahati']), 'keyword word prefix');
    assert.equal(matchEntry('xyz', 'About', ['IIT Guwahati']), null);
  });

  test('ignores case and accents, and highlights the original characters', () => {
    const match = matchEntry('resume', 'My Résumé');
    assert.ok(match);
    assert.deepEqual(match.ranges, [[3, 9]]);
    assert.equal('My Résumé'.slice(3, 9), 'Résumé');
  });

  test('single letters only match at word starts', () => {
    assert.ok(matchEntry('a', 'About'));
    assert.equal(matchEntry('b', 'About'), null);
  });

  test('an empty query matches nothing', () => {
    assert.equal(matchEntry('   ', 'Home'), null);
  });
});

describe('highlight', () => {
  test('splits text into plain and marked runs', () => {
    assert.deepEqual(highlight('Switch to light theme', [[10, 15]]), [
      { text: 'Switch to ', mark: false },
      { text: 'light', mark: true },
      { text: ' theme', mark: false },
    ]);
  });

  test('merges overlapping ranges and clamps to the text', () => {
    assert.deepEqual(mergeRanges([[4, 8], [0, 2], [6, 10]]), [[0, 2], [4, 10]]);
    assert.deepEqual(highlight('Home', [[2, 99]]), [{ text: 'Ho', mark: false }, { text: 'me', mark: true }]);
    assert.deepEqual(highlight('Home', []), [{ text: 'Home', mark: false }]);
  });
});

describe('displayRoute', () => {
  test('site paths read without the trailing slash; anchors are kept', () => {
    assert.equal(displayRoute('/blog/'), '/blog');
    assert.equal(displayRoute('/blog/some-post/'), '/blog/some-post');
    assert.equal(displayRoute('/'), '/');
    assert.equal(displayRoute('/#writing'), '/#writing');
    assert.equal(displayRoute('/rss.xml'), '/rss.xml');
    assert.equal(displayRoute('http://127.0.0.1:4513/about/', 'http://127.0.0.1:4513'), '/about');
  });

  test('other origins read as host + path', () => {
    assert.equal(displayRoute('https://github.com/roshandash411'), 'github.com/roshandash411');
    assert.equal(displayRoute('https://www.linkedin.com/in/roshan-dash'), 'linkedin.com/in/roshan-dash');
  });
});

describe('copy', () => {
  test('result counts (copy deck §7.9)', () => {
    assert.equal(resultCount(1), '1 result');
    assert.equal(resultCount(0), '0 results');
    assert.equal(resultCount(5, 12.4), '5 results · 12 ms');
    assert.equal(resultCount(2, 0.2), '2 results · 1 ms');
  });

  test('Apple platforms get ⌘', () => {
    assert.ok(isApplePlatform('macOS'));
    assert.ok(isApplePlatform('MacIntel'));
    assert.ok(isApplePlatform('iPhone'));
    assert.ok(!isApplePlatform('Win32'));
    assert.ok(!isApplePlatform('Linux x86_64'));
  });
});
