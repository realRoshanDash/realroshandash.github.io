/**
 * Plain-text helpers: markdown → text for excerpts, feeds and meta descriptions; reading time; URL slugs.
 * Pure (no Astro imports), so `node --test` can cover it.
 *
 * markdownToPlain is a pragmatic stripper, not a parser. It handles the syntax this site's content uses:
 * CommonMark, GFM tables / task lists / footnotes, callouts (> [!NOTE]), inline HTML and MDX imports/JSX.
 */

const WORDS_PER_MINUTE = 230;

// While the other rules run, private-use code points stand in for backslash escapes and for text that must come
// out exactly as written (code, and link URLs when shown), so \*literal\* in prose or `**kwargs` in code is never
// mistaken for markup.
const ESCAPED = 0xe000; // an escaped ASCII punctuation character c is held as U+E000 + c (U+E021–U+E07E)
const LITERAL_OPEN = '\ue100';
const LITERAL_CLOSE = '\ue101';
// A fenced code block kept by `keepCode` is a paragraph of its own: markdownToBlocks returns it with its line breaks.
const BLOCK_OPEN = '\ue102';
const BLOCK_CLOSE = '\ue103';
const LITERAL_TOKEN = new RegExp(`[${LITERAL_OPEN}${BLOCK_OPEN}](\\d+)[${LITERAL_CLOSE}${BLOCK_CLOSE}]`, 'g');
const BLOCK_TOKEN = new RegExp(`^${BLOCK_OPEN}\\d+${BLOCK_CLOSE}$`);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z]+);/gi, (match, name: string) => {
    const key = name.toLowerCase();
    if (name[0] !== '#') return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : match; // own keys: not &constructor;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    // Never decode to a placeholder code point (U+E000–U+E1FF), so an entity can't forge an escape or a literal.
    return code > 0 && code <= 0x10ffff && (code < 0xe000 || code > 0xe1ff) ? String.fromCodePoint(code) : match;
  });
}

/**
 * Remove fenced code blocks (``` / ~~~). With `keep`, each block becomes a paragraph of its own instead: the
 * placeholder that `keep` returns for the block's text. An unclosed fence runs to the end.
 */
function stripFences(md: string, keep: ((code: string) => string) | null): string {
  const out: string[] = [];
  let fence = '';
  let code: string[] = [];
  const endBlock = () => {
    if (keep) out.push(keep(code.join('\n')));
    out.push('');
    fence = '';
    code = [];
  };
  for (const line of md.split('\n')) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) endBlock();
      else code.push(line);
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
  if (fence) endBlock();
  return out.join('\n');
}

/** The URL part of an inline link's destination: `url` or `<url>`, either one optionally followed by a title. */
function destinationUrl(destination: string): string {
  const trimmed = destination.trim();
  return (trimmed[0] === '<' ? /^<([^<>\n]*)>/.exec(trimmed)?.[1] : /^\S*/.exec(trimmed)?.[0]) ?? '';
}

/** `url` resolved against `base` (an absolute URL) when it is relative, else as written. */
function resolveUrl(url: string, base: string | undefined): string {
  if (!url || !base || /^[a-z][a-z\d+.-]*:/i.test(url)) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
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

/** Inline syntax for one paragraph. `link` gives what a link shows, from its text and its destination. */
function stripInline(text: string, link: (label: string, destination: string) => string): string {
  return text
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, '') // images
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '') // reference images
    .replace(/\[\^[^\]]+\]/g, '') // footnote references
    // Links. The text may be empty: a linked image or badge, [![CI](ci.svg)](…), is [](…) once the image is gone.
    .replace(/\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_, label: string, destination: string) => link(label, destination))
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // reference links → their text
    .replace(/<mailto:([^>\s]+)>/gi, '$1') // autolinks
    .replace(/<((?:https?|ftp):\/\/[^>\s]+)>/gi, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[A-Za-z][\w.:-]*(?:\s[^<>]*)?\/?>/g, '') // HTML / JSX tags
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2') // strong
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1') // strikethrough
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1') // emphasis
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1$2');
}

export interface PlainTextOptions {
  /** Keep fenced code blocks, exactly as written, each as a paragraph of its own. By default they are dropped. */
  keepCode?: boolean;
  /** Show inline links as "text (url)", or as the bare URL when the text is empty or is the URL itself. */
  linkUrls?: boolean;
  /** With `linkUrls`: the absolute URL that relative link URLs are resolved against, i.e. the page's own URL. */
  baseUrl?: string;
}

/** One block of markdownToBlocks: a paragraph of plain text, or a fenced code block exactly as written. */
export interface PlainBlock {
  type: 'text' | 'code';
  /** Text: one line, whitespace collapsed. Code: as written, line breaks and indentation included. */
  text: string;
}

/**
 * Markdown (or MDX) → plain-text blocks, in order. Paragraphs, headings, list items and table rows are text
 * blocks of one line each. Fenced code blocks are dropped unless `keepCode`, which keeps each one as a code block
 * with its line breaks. Code is never treated as markup, and its entities and backslashes stay as written. Inline
 * code and link text are kept, link URLs too with `linkUrls`; images are dropped.
 */
export function markdownToBlocks(md: string, { keepCode = false, linkUrls = false, baseUrl }: PlainTextOptions = {}): PlainBlock[] {
  const literals: string[] = [];
  const literal = (text: string) => `${LITERAL_OPEN}${literals.push(text) - 1}${LITERAL_CLOSE}`;
  const block = (code: string) => `${BLOCK_OPEN}${literals.push(code) - 1}${BLOCK_CLOSE}`;
  // Entities are decoded before the placeholders are put back, so `&lt;` in code and \&amp; in prose stay as written.
  const finish = (text: string) =>
    decodeEntities(text)
      .replace(LITERAL_TOKEN, (_, i: string) => literals[Number(i)] ?? '')
      .replace(/[\ue021-\ue07e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - ESCAPED));

  let text = stripFences(md.replace(/\r\n?/g, '\n'), keepCode ? block : null);

  // Escapes and code spans in one left-to-right pass, so \` can't open a code span and a backslash inside one is
  // kept: `\d+\.` stays as written.
  text = text.replace(/\\([!-/:-@[-`{-~])|(`+)([^\n]+?)\2(?!`)/g, (_, escaped?: string, _ticks?: string, code = '') =>
    escaped ? String.fromCharCode(ESCAPED + escaped.charCodeAt(0)) : literal(code.trim()),
  );

  text = text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '') // HTML comments
    .replace(/^import\s+(?:[\w*{}\s,]+\s+from\s+)?['"][^'"\n]+['"];?[ \t]*$/gm, '') // MDX ESM
    .replace(/^export\s+(?:(?:const|let|var|function|class|default|async)\b|\{)[^\n]*$/gm, '')
    .split('\n')
    .map(stripBlock)
    .join('\n');

  const link = (label: string, destination: string): string => {
    if (!linkUrls) return label;
    const url = resolveUrl(finish(destinationUrl(destination)), baseUrl);
    if (!url) return label;
    const shown = finish(label).trim();
    return shown && shown !== url ? `${label} (${literal(url)})` : literal(url);
  };

  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph): PlainBlock => {
      const trimmed = paragraph.trim();
      return BLOCK_TOKEN.test(trimmed)
        ? // Leading blank lines and trailing whitespace go; indentation and inner blank lines stay.
          { type: 'code', text: finish(trimmed).replace(/^(?:[ \t]*\n)+/, '').trimEnd() }
        : { type: 'text', text: finish(stripInline(paragraph, link)).replace(/\s+/g, ' ').trim() };
    })
    .filter((b) => b.text);
}

/**
 * Markdown (or MDX) → plain text, paragraphs separated by a blank line (markdownToBlocks, joined). Kept code
 * blocks are flattened to one line here, which suits word counts and excerpts; markdownToFeedHtml keeps their
 * line breaks.
 */
export function markdownToPlain(md: string, options: PlainTextOptions = {}): string {
  return markdownToBlocks(md, options)
    .map((b) => (b.type === 'code' ? b.text.replace(/\s+/g, ' ').trim() : b.text))
    .join('\n\n');
}

/**
 * Markdown (or MDX) → the simple HTML a feed reader shows (an item's content:encoded): a <p> per paragraph of
 * plain text, and every fenced code block as <pre><code>, exactly as written with its line breaks.
 */
export function markdownToFeedHtml(md: string, options: Omit<PlainTextOptions, 'keepCode'> = {}): string {
  return markdownToBlocks(md, { ...options, keepCode: true })
    .map((b) => (b.type === 'code' ? `<pre><code>${escapeHtml(b.text)}</code></pre>` : `<p>${escapeHtml(b.text)}</p>`))
    .join('');
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
 * "+", and "#" right after a letter or digit, are spelled out so that languages keep apart: "C++" → "c-plus-plus",
 * "C#" → "c-sharp", "F#" → "f-sharp" (and "C" → "c"). A hashtag's "#" just goes: "#topic" → "topic".
 * Returns '' when nothing URL-safe is left (e.g. "日本"); callers must handle that.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/([a-z0-9])#/g, '$1 sharp ')
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
