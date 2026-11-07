/**
 * The notes feed carries each note's full text (content:encoded). Regression: multi-line fenced code used to be
 * flattened onto one line, because markdownToPlain collapses whitespace after code is restored. The feed now
 * renders through markdownToFeedHtml, which keeps every code block as <pre><code> with its line breaks.
 * Run: node --test tests/note-feed.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { markdownToBlocks, markdownToFeedHtml, markdownToPlain } from '../src/lib/text.ts';

// The options noteFeedItem (src/lib/content.ts) passes: link targets shown, relative ones made absolute.
const NOTE_URL = 'https://roshandash.com/notes/til/';
const feed = (md: string) => markdownToFeedHtml(md, { linkUrls: true, baseUrl: NOTE_URL });

describe('markdownToFeedHtml (notes feed content)', () => {
  test('a multi-line code block keeps its line breaks', () => {
    const md = 'Two commands:\n\n```sh\nnpm ci\nnpm test\n```\n\nThat is all.';
    assert.equal(feed(md), '<p>Two commands:</p><pre><code>npm ci\nnpm test</code></pre><p>That is all.</p>');
  });

  test('blank lines and indentation inside code survive; trailing blank lines do not', () => {
    const md = '```java\nclass A {\n\n  void run() {\n    go();\n  }\n}\n\n\n```';
    assert.equal(feed(md), '<pre><code>class A {\n\n  void run() {\n    go();\n  }\n}</code></pre>');
  });

  test('code is escaped and never read as markdown, entities and backslashes included', () => {
    const md = '```py\n# not a heading\nf(**kw) & <b>&amp; \\.\n[x](y)\n```';
    assert.equal(feed(md), '<pre><code># not a heading\nf(**kw) &amp; &lt;b&gt;&amp;amp; \\.\n[x](y)</code></pre>');
  });

  test('tilde fences, longer fences, and an unclosed fence that runs to the end', () => {
    assert.equal(feed('~~~\na\nb\n~~~'), '<pre><code>a\nb</code></pre>');
    assert.equal(feed('````md\n```\nnested\n```\n````'), '<pre><code>```\nnested\n```</code></pre>');
    assert.equal(feed('Intro.\n\n```\nnever\n\nclosed'), '<p>Intro.</p><pre><code>never\n\nclosed</code></pre>');
  });

  test('prose paragraphs stay plain text: one <p> each, inline code kept, link URLs shown and resolved', () => {
    const md = 'See [the docs](https://example.com/a) and [my post](/blog/x/).\nSame paragraph, `npm ci` too.\n\nNext *one*.';
    assert.equal(
      feed(md),
      '<p>See the docs (https://example.com/a) and my post (https://roshandash.com/blog/x/). Same paragraph, npm ci too.</p>' +
        '<p>Next one.</p>',
    );
  });

  test('a paragraph that is only inline code is still a paragraph, not a code block', () => {
    assert.equal(feed('`npm ci`'), '<p>npm ci</p>');
  });

  test('empty code blocks and empty input produce nothing', () => {
    assert.equal(feed('```\n```'), '');
    assert.equal(feed(''), '');
  });

  test('the seeded TIL note keeps its shell command on its own lines', () => {
    const md = [
      'On Node 24, `node --test` runs `.ts` test files directly.',
      '',
      '```sh',
      'node --test tests/',
      'node --test --watch tests/',
      '```',
      '',
      'Two things to know.',
    ].join('\n');
    assert.equal(
      feed(md),
      '<p>On Node 24, node --test runs .ts test files directly.</p>' +
        '<pre><code>node --test tests/\nnode --test --watch tests/</code></pre>' +
        '<p>Two things to know.</p>',
    );
  });
});

describe('markdownToBlocks', () => {
  test('code blocks only with keepCode; text blocks are single-spaced paragraphs', () => {
    const md = 'A\nb.\n\n```\nx\ny\n```';
    assert.deepEqual(markdownToBlocks(md), [{ type: 'text', text: 'A b.' }]);
    assert.deepEqual(markdownToBlocks(md, { keepCode: true }), [
      { type: 'text', text: 'A b.' },
      { type: 'code', text: 'x\ny' },
    ]);
  });
});

describe('markdownToPlain is unchanged for excerpts and word counts', () => {
  test('kept code is still one line of plain text there', () => {
    const md = 'Before.\n\n```sh\nnpm ci\nnpm test\n```\n\nAfter.';
    assert.equal(markdownToPlain(md, { keepCode: true }), 'Before.\n\nnpm ci npm test\n\nAfter.');
    assert.equal(markdownToPlain(md), 'Before.\n\nAfter.');
  });
});
