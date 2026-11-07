/**
 * Writing display rules (src/components/writing/display.ts): numbering, reading time, tag labels and links,
 * view-transition names, punctuation, year groups and safe JSON-LD.
 * Run: node --test tests/writing.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  byYear,
  formatNo,
  jsonLd,
  keepDashes,
  longestWord,
  minutesToRead,
  NO_VALUE,
  postNumbers,
  tagLabel,
  tagRefs,
  vtName,
} from '../src/components/writing/display.ts';

const entry = (id: string, published: string, draft = false) => ({ id, data: { draft, published: new Date(published) } });

describe('postNumbers', () => {
  test('No. 001 is the oldest published post; drafts are never numbered', () => {
    const numbers = postNumbers([
      entry('newest', '2026-11-07'),
      entry('draft', '2026-01-01', true),
      entry('oldest', '2021-09-08'),
      entry('middle', '2024-03-02'),
    ]);
    assert.deepEqual([...numbers], [['oldest', 1], ['middle', 2], ['newest', 3]]);
    assert.equal(numbers.get('draft'), undefined);
  });

  test('a draft never shifts the numbers of published posts', () => {
    const published = [entry('a', '2025-01-01'), entry('b', '2025-02-01')];
    const withDraft = [...published, entry('c', '2024-12-31', true)];
    assert.deepEqual([...postNumbers(withDraft)], [...postNumbers(published)]);
  });

  test('same-day posts are ordered by id, so every build agrees', () => {
    assert.deepEqual([...postNumbers([entry('b', '2026-11-07'), entry('a', '2026-11-07')]).keys()], ['a', 'b']);
  });
});

describe('formatNo', () => {
  test('three digits, or the en dash ("no value") for a draft', () => {
    assert.equal(formatNo(4), '004');
    assert.equal(formatNo(1234), '1234');
    assert.equal(formatNo(undefined), NO_VALUE);
    assert.equal(NO_VALUE, '–');
  });
});

describe('minutesToRead', () => {
  test('ceil(words / 230), at least 1', () => {
    assert.equal(minutesToRead(undefined), 1);
    assert.equal(minutesToRead(''), 1);
    assert.equal(minutesToRead(Array(230).fill('word').join(' ')), 1);
    assert.equal(minutesToRead(Array(231).fill('word').join(' ')), 2);
  });

  test('code counts, markup does not', () => {
    const md = `## Heading\n\n${Array(229).fill('word').join(' ')}\n\n\`\`\`sh\nnpm ci\n\`\`\``;
    assert.equal(minutesToRead(md), 2); // 1 + 229 + 2 = 232 words
  });
});

describe('tagLabel', () => {
  test('slug-style tags read as sentence case with acronyms', () => {
    assert.equal(tagLabel('distributed-systems'), 'Distributed systems');
    assert.equal(tagLabel('ai-agents'), 'AI agents');
    assert.equal(tagLabel('java'), 'Java');
    assert.equal(tagLabel('system design'), 'System design');
    assert.equal(tagLabel('  sql_tuning '), 'SQL tuning');
  });

  test('a tag written with capitals is shown as written', () => {
    assert.equal(tagLabel('PostgreSQL'), 'PostgreSQL');
    assert.equal(tagLabel('AI agents'), 'AI agents');
  });
});

describe('tagRefs', () => {
  test('one link per slug, to the tag page; unsluggable tags get none', () => {
    assert.deepEqual(tagRefs(['Java', 'java', 'Distributed systems', '日本']), [
      { label: 'Java', slug: 'java', href: '/blog/tags/java/' },
      { label: 'Distributed systems', slug: 'distributed-systems', href: '/blog/tags/distributed-systems/' },
    ]);
  });
});

describe('vtName', () => {
  test('a valid CSS ident per post id', () => {
    assert.equal(vtName('idempotency-keys'), 'post-idempotency-keys');
    assert.equal(vtName('2021/From Vim'), 'post-p-2021-from-vim');
    assert.match(vtName('Ünïcode & co.'), /^post-[a-z0-9-]+$/);
  });
});

describe('keepDashes', () => {
  test('the space before a spaced em dash does not break; en dashes and hyphens are left alone', () => {
    assert.equal(keepDashes('Retries are inevitable — mostly.'), 'Retries are inevitable\u00a0— mostly.');
    assert.equal(keepDashes('2026–2027, well-known'), '2026–2027, well-known');
  });
});

describe('byYear', () => {
  test('newest year first, order kept within a year', () => {
    const items = [{ id: 'c', year: '2026' }, { id: 'b', year: '2021' }, { id: 'd', year: '2026' }, { id: 'a', year: '2021' }];
    assert.deepEqual(
      byYear(items).map((group) => [group.year, group.items.map((item) => item.id)]),
      [['2026', ['c', 'd']], ['2021', ['b', 'a']]],
    );
  });
});

describe('longestWord', () => {
  test('characters in the longest word (code points)', () => {
    assert.equal(longestWord('Writing'), 7);
    assert.equal(longestWord('Distributed systems'), 11);
    assert.equal(longestWord(''), 1);
  });
});

describe('jsonLd', () => {
  test('a title can never close the script element', () => {
    const json = jsonLd({ headline: 'Escaping </script><script>alert(1)</script>' });
    assert.ok(!json.includes('<'));
    assert.deepEqual(JSON.parse(json), { headline: 'Escaping </script><script>alert(1)</script>' });
  });
});
