import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapeHtml, excerpt, markdownToPlain, readingTime, slugify, truncate } from '../src/lib/text.ts';

describe('markdownToPlain', () => {
  test('headings, emphasis and strikethrough keep their text', () => {
    assert.equal(
      markdownToPlain('## A *big* __deal__ ##\n\nSome **bold**, _em_, ***both*** and ~~old~~ text.'),
      'A big deal\n\nSome bold, em, both and old text.',
    );
  });

  test('links keep their text; images, footnote markers and reference definitions go', () => {
    const md = [
      'See [the docs](https://example.com/a_(b) "Title"), [a ref][1] and <https://example.com>. ![chart](chart.png)Done[^n].',
      '',
      '[1]: https://example.com',
      '[^n]: A footnote.',
    ].join('\n');
    assert.equal(markdownToPlain(md), 'See the docs, a ref and https://example.com. Done.\n\nA footnote.');
  });

  test('code blocks are dropped, or kept for word counts; inline code keeps its text', () => {
    const md = 'Run `npm ci` first.\n\n```sh\nnpm run build\n```\n\nThen deploy.';
    assert.equal(markdownToPlain(md), 'Run npm ci first.\n\nThen deploy.');
    assert.equal(markdownToPlain(md, { keepCode: true }), 'Run npm ci first.\n\nnpm run build\n\nThen deploy.');
  });

  test('markup inside code spans is literal', () => {
    assert.equal(markdownToPlain('Use `**kwargs` and `<div>`, not ``a ` b``.'), 'Use **kwargs and <div>, not a ` b.');
  });

  test('tilde fences, longer fences and unclosed fences', () => {
    assert.equal(markdownToPlain('a\n\n~~~\ncode\n~~~\n\nb'), 'a\n\nb');
    assert.equal(markdownToPlain('a\n\n````md\n```\nnested\n```\n````\n\nb'), 'a\n\nb');
    assert.equal(markdownToPlain('a\n\n```\nnever closed\n\nstill code'), 'a');
  });

  test('inline HTML, comments and MDX imports/exports/JSX', () => {
    const mdx = [
      "import Chart from '../components/Chart.astro';",
      "import { Callout } from 'somewhere';",
      'export const meta = { draft: true };',
      '',
      '<Chart data={points} />',
      '',
      'Text with <abbr title="R-multiple">R</abbr><br>and a break.<!-- hidden -->',
    ].join('\n');
    assert.equal(markdownToPlain(mdx), 'Text with R and a break.');
    // Prose that merely starts with "import" stays.
    assert.equal(markdownToPlain("import duties make 'cheap' gear expensive"), "import duties make 'cheap' gear expensive");
  });

  test('blockquotes, callouts, lists, task lists and tables', () => {
    const md = [
      '> [!WARNING] Risk',
      '> Size from the stop.',
      '',
      '- one',
      '- [x] two',
      '1. three',
      '',
      '| Ticker | R |',
      '|---|---:|',
      '| NVDA | 2.0 |',
    ].join('\n');
    assert.equal(markdownToPlain(md), 'Risk Size from the stop.\n\none\n\ntwo\n\nthree\n\nTicker · R\n\nNVDA · 2.0');
  });

  test('rules and setext underlines disappear', () => {
    assert.equal(markdownToPlain('Title\n=====\n\nOne\n\n---\n\n* * *\n\nTwo'), 'Title\n\nOne\n\nTwo');
  });

  test('backslash escapes and entities', () => {
    assert.equal(
      markdownToPlain('Costs \\$810, \\*not em\\* &amp; &lt;b&gt; &#8212; &#x2014; &copy;'),
      'Costs $810, *not em* & <b> — — &copy;',
    );
  });

  test('whitespace is normalised and empty input stays empty', () => {
    assert.equal(markdownToPlain('  one\r\n  two  \r\n\r\n\r\n three '), 'one two\n\nthree');
    assert.equal(markdownToPlain(''), '');
  });
});

describe('truncate / excerpt', () => {
  const md = 'The *quick* brown fox jumps over the lazy dog, then naps in the sun for the rest of the afternoon.';

  test('short text comes back whole, as one line', () => {
    assert.equal(excerpt('Just *this*.\n\nAnd that.'), 'Just this. And that.');
  });

  test('cuts at a word boundary, ellipsis included in the limit', () => {
    for (const [limit, expected] of [
      [40, 'The quick brown fox jumps over the lazy…'],
      [38, 'The quick brown fox jumps over the…'],
      [45, 'The quick brown fox jumps over the lazy dog…'], // trailing comma dropped
    ] as const) {
      const out = excerpt(md, limit);
      assert.equal(out, expected);
      assert.ok(Array.from(out).length <= limit);
    }
  });

  test('hard-cuts a single overlong word and never splits an emoji', () => {
    assert.equal(truncate('https://example.com/a/very/long/path', 12), 'https://exa…');
    const grin = String.fromCodePoint(0x1f600);
    assert.equal(truncate(grin.repeat(10), 5), `${grin.repeat(4)}…`);
  });
});

describe('readingTime', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

  test('at least a minute', () => {
    assert.deepEqual(readingTime('Hello there.'), { minutes: 1, words: 2 });
    assert.deepEqual(readingTime(''), { minutes: 1, words: 0 });
  });

  test('about 230 words per minute', () => {
    assert.deepEqual(readingTime(words(460)), { minutes: 2, words: 460 });
    assert.equal(readingTime(words(1150)).minutes, 5);
  });

  test('counts code, not markup or bare punctuation', () => {
    assert.equal(readingTime('# Title\n\n**One** two — three.\n\n```\nconst four = 4;\n```').words, 7);
  });
});

describe('slugify', () => {
  test('lowercase ASCII words joined by single hyphens', () => {
    assert.equal(slugify('Machine Learning'), 'machine-learning');
    assert.equal(slugify('  Risk   management  '), 'risk-management');
    assert.equal(slugify('S&P 500'), 's-p-500');
    assert.equal(slugify('C++ / Rust'), 'c-rust');
    assert.equal(slugify('node.js'), 'node-js');
    assert.equal(slugify('snake_case'), 'snake-case');
    assert.equal(slugify('AI'), slugify('ai'));
  });

  test('folds accents and drops apostrophes', () => {
    assert.equal(slugify('Café Crème'), 'cafe-creme');
    assert.equal(slugify("Today's picks"), 'todays-picks');
    assert.equal(slugify('Today’s picks'), 'todays-picks');
  });

  test('nothing URL-safe left', () => assert.equal(slugify('日本'), ''));
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
});
