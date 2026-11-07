/**
 * The Markdown pipeline's own HAST plugins (src/lib/markdown/), run through Sätteri as astro.config.mjs does.
 * Run: node --test tests/markdown.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { markdownToHtml } from 'satteri';
import { normalizeHeadings } from '../src/lib/markdown/normalize-headings.ts';
import { wrapTables } from '../src/lib/markdown/wrap-tables.ts';

const render = async (md: string) =>
  markdownToHtml(md, { hastPlugins: [normalizeHeadings, wrapTables], features: { gfm: { footnotes: { backContent: '↑' } } } }).html;

const levels = (html: string) => [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));

describe('normalizeHeadings', () => {
  test('a post that starts at ### gets h2 sections, depth kept below', async () => {
    assert.deepEqual(levels(await render('### One\n\n#### One.a\n\n### Two\n')), [2, 3, 2]);
  });

  test('a body # never makes a second <h1>', async () => {
    assert.deepEqual(levels(await render('# Top\n\n## Sub\n\n### Deeper\n')), [2, 3, 4]);
  });

  test('h2-based posts are left alone', async () => {
    assert.deepEqual(levels(await render('## A\n\n### B\n\n#### C\n')), [2, 3, 4]);
  });

  test('inline markup in a heading survives', async () => {
    assert.match(await render('### Using `keys` *well*\n'), /<h2[^>]*>Using <code>keys<\/code> <em>well<\/em><\/h2>/);
  });

  test('the footnotes label is neither counted nor moved', async () => {
    const html = await render('Text.[^1]\n\n### Section\n\n[^1]: Note.\n');
    assert.match(html, /<h2>Section<\/h2>/);
    assert.match(html, /<h2 class="sr-only" id="footnote-label">Footnotes<\/h2>/);
    assert.match(html, /data-footnote-backref[^>]*>↑</);
  });
});

describe('wrapTables', () => {
  test('a table scrolls inside a labelled, focusable region', async () => {
    const html = await render('| A | B |\n| --- | --: |\n| 1 | 2 |\n');
    assert.match(html, /^<div class="table-scroll" role="region" aria-label="Table" tabindex="0"><table>/);
    assert.equal(html.match(/table-scroll/g)?.length, 1);
  });

  test('a document without tables is untouched', async () => {
    assert.equal((await render('Just text.\n')).trim(), '<p>Just text.</p>');
  });
});
