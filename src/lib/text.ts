/**
 * Plain-text helpers: markdown → text for excerpts, feeds and meta descriptions; reading time; URL slugs.
 * Pure (no Astro imports), so `node --test` can cover it.
 *
 * markdownToPlain is a pragmatic stripper, not a parser. It handles the syntax this site's content uses:
 * CommonMark, GFM tables / task lists / footnotes, callouts (> [!NOTE]), inline HTML and MDX imports/JSX.
 */

const WORDS_PER_MINUTE = 230;

// While the other rules run, private-use code points stand in for backslash escapes and code spans, so
// \*literal\* in prose or `**kwargs` in code is never mistaken for markup.
const ESCAPED = 0xe000; // an escaped ASCII punctuation character c is held as U+E000 + c (U+E021–U+E07E)
const CODE_OPEN = '\ue100';
const CODE_CLOSE = '\ue101';
const CODE_TOKEN = new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g');

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z]+);/gi, (match, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? match;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Remove fenced code blocks (``` / ~~~), or keep only their text. An unclosed fence runs to the end. */
function stripFences(md: string, keepCode: boolean): string {
  const out: string[] = [];
  let fence = '';
  for (const line of md.split('\n')) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) {
        fence = '';
        out.push('');
      } else if (keepCode) {
        out.push(line);
      }
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (open) {
      fence = open;
      out.push('');
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/** Block syntax for one line. Headings, list items and table rows become paragraphs of their own. */
function stripBlock(line: string): string {
  if (/^ {0,3}\[[^\]^][^\]]*\]:\s+\S/.test(line)) return ''; // link reference definition
  if (/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|=+[ \t]*)$/.test(line)) return ''; // rule / setext underline
  if (/^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(line)) return ''; // table delimiter row

  let text = line
    .replace(/^ {0,3}\[\^[^\]]+\]:\s*/, '') // footnote definition marker (keep its text)
    .replace(/^ {0,3}(?:>[ \t]?)+/, '') // blockquote markers
    .replace(/^\[![A-Za-z]+\][+-]?[ \t]*/, ''); // callout marker: > [!NOTE] Title

  const heading = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(text);
  if (heading) return `\n${heading[1] ?? ''}\n`;

  const item = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(text);
  if (item) return `\n${text.slice(item[0].length)}`;

  if (/^\s*\|.*\|\s*$/.test(text)) {
    text = text.trim().slice(1, -1).split('|').map((cell) => cell.trim()).filter(Boolean).join(' · ');
    return `\n${text}\n`;
  }
  return text;
}

/** Inline syntax for one paragraph. */
function stripInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, '') // images
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '') // reference images
    .replace(/\[\^[^\]]+\]/g, '') // footnote references
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1') // links → their text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // reference links
    .replace(/<mailto:([^>\s]+)>/gi, '$1') // autolinks
    .replace(/<((?:https?|ftp):\/\/[^>\s]+)>/gi, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[A-Za-z][\w.:-]*(?:\s[^<>]*)?\/?>/g, '') // HTML / JSX tags
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2') // strong
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1') // strikethrough
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1') // emphasis
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1$2');
}

/**
 * Markdown (or MDX) → plain text, paragraphs separated by a blank line. Code blocks are dropped unless
 * `keepCode` (reading time counts them). Inline code and link text are kept; images are dropped.
 */
export function markdownToPlain(md: string, { keepCode = false }: { keepCode?: boolean } = {}): string {
  let text = stripFences(md.replace(/\r\n?/g, '\n'), keepCode);

  text = text.replace(/\\([!-/:-@[-`{-~])/g, (_, char: string) => String.fromCharCode(ESCAPED + char.charCodeAt(0)));
  const spans: string[] = [];
  text = text.replace(/(`+)([^\n]+?)\1(?!`)/g, (_, _ticks, code: string) => {
    spans.push(code.trim());
    return `${CODE_OPEN}${spans.length - 1}${CODE_CLOSE}`;
  });

  text = text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '') // HTML comments
    .replace(/^import\s+(?:[\w*{}\s,]+\s+from\s+)?['"][^'"\n]+['"];?[ \t]*$/gm, '') // MDX ESM
    .replace(/^export\s+(?:(?:const|let|var|function|class|default|async)\b|\{)[^\n]*$/gm, '')
    .split('\n')
    .map(stripBlock)
    .join('\n');

  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) =>
      decodeEntities(
        stripInline(paragraph)
          .replace(CODE_TOKEN, (_, i: string) => spans[Number(i)] ?? '')
          .replace(/[\ue021-\ue07e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - ESCAPED)),
      )
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Shorten plain text to at most `maxChars` characters (ellipsis included), cutting at a word boundary when
 * one is reasonably close; a single overlong word is cut hard.
 */
export function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim()); // by code point, so emoji aren't split
  const limit = Math.max(1, Math.floor(maxChars));
  if (chars.length <= limit) return chars.join('');
  const head = chars.slice(0, limit - 1).join('');
  const space = head.lastIndexOf(' ');
  const atBoundary = chars[limit - 1] === ' ';
  const cut = atBoundary || space < head.length / 2 ? head : head.slice(0, space);
  return `${cut.replace(/[\s,;:.\-–—(]+$/u, '')}…`;
}

/** First `maxChars` characters of a markdown document as one line of plain text. */
export function excerpt(md: string, maxChars = 160): string {
  return truncate(markdownToPlain(md), maxChars);
}

/** Words (whitespace-separated tokens with a letter or digit) and minutes at ~230 wpm, at least 1. */
export function readingTime(md: string): { minutes: number; words: number } {
  const words = markdownToPlain(md, { keepCode: true })
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  return { minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)), words };
}

/**
 * URL slug for a tag or title: lowercase ASCII letters and digits joined by single hyphens.
 * "Machine Learning" → "machine-learning", "Café" → "cafe", "Today's picks" → "todays-picks".
 * Returns '' when nothing URL-safe is left (e.g. "日本"); callers must handle that.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Escape text for HTML element content or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
