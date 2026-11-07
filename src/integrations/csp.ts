/**
 * Content-Security-Policy for a static host. GitHub Pages sends no custom response headers, so each page carries
 * its policy as <meta http-equiv="Content-Security-Policy">, inserted straight after <meta charset> so that it
 * governs everything after it, the inline theme bootstrap included.
 *
 * After the build, this pass reads every page Astro wrote and hashes exactly what that page contains inline: its
 * scripts (the theme bootstrap, small modules Astro inlined), its <style> elements (font faces, inlined component
 * CSS) and its style="" attributes (optical-margin offsets, view-transition names, code-token colours). So no
 * directive needs 'unsafe-inline', the hashes can never drift from the code, and a page allows nothing it does not
 * use. Why not Astro's own `security.csp`: it puts the meta where Astro injects head content, after the layout's
 * head, so the bootstrap and the @font-face styles run before the policy exists, and it never hashes an is:inline
 * script; every page's policy lists every page's hashes; and style attributes would need
 * style-src-attr 'unsafe-inline'.
 *
 * A component that needs more than this declares it where the need is: `data-csp="script-src https://cdn.example;
 * frame-src https://embed.example"` on any element adds those sources to the policy of the pages it is rendered
 * on, and nowhere else (the dormant chart facade uses it for its click-to-load embed).
 *
 * Not possible from a meta tag: frame-ancestors, report-to and sandbox (browsers ignore them there). `astro dev`
 * runs without a policy; check it with `npm run build && npm run preview`.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

export type Policy = Record<string, readonly string[]>;

/**
 * The site's policy. Hashes are added per page: script-src gets the page's inline scripts, style-src its <style>
 * elements, and style-src-attr its style attributes ('unsafe-hashes' + their hashes, or 'none' when it has none).
 * Elements stay on style-src rather than style-src-elem, so engines without the -elem/-attr directives still get a
 * styled page; there, style attributes alone fall back to style-src and are blocked.
 */
export const SITE_POLICY: Policy = {
  'default-src': ["'self'"],
  // Pagefind (⌘K full-text search) compiles WebAssembly. No 'unsafe-eval': nothing evaluates strings as code.
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  'style-src-attr': [],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  // The contact gate's proof-of-work and Pagefind run in same-origin worker scripts (no blob: workers).
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'", 'mailto:'],
};

/* ------------------------------------------------------------------ scanning ---- */

export interface PageScan {
  /** Inline scripts the browser runs: classic, module, importmap and speculation rules. JSON data blocks don't run. */
  scripts: string[];
  /** Text of every <style> element. */
  styles: string[];
  /** Every style="" value, as the browser reads it (entities decoded). */
  styleAttrs: string[];
  /** data-csp values: sources a component adds to its page's policy. */
  extensions: string[];
  /** Inline event-handler attributes (onclick…): the policy would block them, so they fail the build instead. */
  handlers: string[];
  /** Offset just after <meta charset>, the first element in <head>, where the policy goes; -1 if not found. */
  insertAt: number;
  /** CSP metas already in the page (replaced, so running the pass twice changes nothing). */
  metas: { start: number; end: number }[];
}

/** Elements whose content is text up to their end tag: a "<" inside is not markup. */
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'title', 'textarea']);
/** Foreign content (inline SVG, MathML): there <style> and <script> are ordinary elements, not raw text. */
const FOREIGN = new Set(['svg', 'math']);
/** Script types the browser runs (HTML's JavaScript MIME type essences, plus module, importmap, speculationrules). */
const RUNNABLE = new Set([
  '', 'module', 'importmap', 'speculationrules', 'text/javascript', 'application/javascript', 'application/ecmascript',
  'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript', 'text/javascript1.0', 'text/javascript1.1',
  'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript',
  'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
]);
const SPACE = /[\t\n\f\r ]/;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/**
 * Decodes the character references Astro and Expressive Code write in attribute values. Anything else fails loudly:
 * a wrong decode would mean a wrong hash.
 */
export function decodeEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (ref, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      return String.fromCodePoint(hex ? parseInt(body.slice(2), 16) : Number(body.slice(1)));
    }
    const char = NAMED[body];
    if (char === undefined) throw new Error(`csp: unsupported character reference ${ref} in a hashed attribute`);
    return char;
  });
}

interface Tag {
  name: string;
  attrs: Map<string, string>;
  /** Offset just after the tag's ">". */
  end: number;
  selfClosing: boolean;
}

/** The start tag at `at` (html[at] is "<"), tokenized as the HTML spec does: names lowercased, first attribute wins. */
function readStartTag(html: string, at: number): Tag {
  let i = at + 1;
  let name = '';
  while (i < html.length && !SPACE.test(html[i]) && html[i] !== '/' && html[i] !== '>') name += html[i++];
  const attrs = new Map<string, string>();
  let selfClosing = false;
  for (;;) {
    while (i < html.length && (SPACE.test(html[i]) || html[i] === '/')) selfClosing = html[i++] === '/';
    if (i >= html.length) throw new Error(`csp: unterminated <${name}> tag`);
    if (html[i] === '>') break;
    selfClosing = false;
    let attr = html[i++];
    while (i < html.length && !SPACE.test(html[i]) && !'/>='.includes(html[i])) attr += html[i++];
    while (SPACE.test(html[i] ?? '')) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (SPACE.test(html[i] ?? '')) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) throw new Error(`csp: unterminated attribute value in <${name}>`);
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        while (i < html.length && !SPACE.test(html[i]) && html[i] !== '>') value += html[i++];
      }
    }
    const key = attr.toLowerCase();
    if (!attrs.has(key)) attrs.set(key, value);
  }
  return { name: name.toLowerCase(), attrs, end: i + 1, selfClosing };
}

/** Offset of `</name` (any case) followed by whitespace, "/" or ">", from `from`; the document's end if absent. */
function endTagAt(html: string, name: string, from: number): number {
  const re = new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'gi');
  re.lastIndex = from;
  return re.exec(html)?.index ?? html.length;
}

/** Everything in a page that its policy has to account for, and where the policy goes. */
export function scanHtml(html: string): PageScan {
  const scan: PageScan = {
    scripts: [], styles: [], styleAttrs: [], extensions: [], handlers: [], insertAt: -1, metas: [],
  };
  let foreign = 0;
  let headOpen = -1;
  let firstInHead = true;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const close = html.indexOf('>', lt);
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const close = html.indexOf('>', lt);
      const name = html.slice(lt + 2, close < 0 ? html.length : close).trim().split(SPACE)[0].toLowerCase();
      if (FOREIGN.has(name) && foreign > 0) foreign--;
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!/[a-zA-Z]/.test(html[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }

    const tag = readStartTag(html, lt);
    i = tag.end;
    // every style attribute, empty ones included: the browser checks the attribute, whatever it holds
    const style = tag.attrs.get('style');
    if (style !== undefined) scan.styleAttrs.push(decodeEntities(style));
    const extension = tag.attrs.get('data-csp');
    if (extension) scan.extensions.push(decodeEntities(extension));
    for (const attr of tag.attrs.keys()) if (/^on[a-z]/.test(attr)) scan.handlers.push(`<${tag.name} ${attr}>`);

    if (tag.name === 'head' && headOpen < 0) {
      headOpen = tag.end;
    } else if (headOpen >= 0 && firstInHead) {
      firstInHead = false;
      if (tag.name === 'meta' && tag.attrs.has('charset')) scan.insertAt = tag.end;
    }
    if (tag.name === 'meta' && tag.attrs.get('http-equiv')?.toLowerCase() === 'content-security-policy') {
      scan.metas.push({ start: lt, end: tag.end });
    }

    if (FOREIGN.has(tag.name) && !tag.selfClosing) foreign++;
    if (foreign > 0) {
      // SVG/MathML <style> and <script>: the browser hashes their text, which must then be plain text.
      if ((tag.name === 'style' || tag.name === 'script') && !tag.selfClosing) {
        const close = endTagAt(html, tag.name, tag.end);
        const text = html.slice(tag.end, close);
        if (text.includes('<')) throw new Error(`csp: markup inside an SVG/MathML <${tag.name}> can't be hashed`);
        (tag.name === 'style' ? scan.styles : scan.scripts).push(decodeEntities(text));
        i = close;
      }
      continue;
    }
    if (!RAW_TEXT.has(tag.name)) continue;

    const close = endTagAt(html, tag.name, tag.end);
    const text = html.slice(tag.end, close);
    i = close;
    if (tag.name === 'style') scan.styles.push(text);
    if (tag.name === 'script') {
      const type = (tag.attrs.get('type') ?? '').split(';')[0].trim().toLowerCase();
      if (!RUNNABLE.has(type) || tag.attrs.has('src')) continue;
      // "<!--" puts script data in an escaped state where the end tag rules differ: never emitted here, so refuse.
      if (text.includes('<!--')) throw new Error('csp: "<!--" inside an inline script');
      scan.scripts.push(text);
    }
  }
  return scan;
}

/* ------------------------------------------------------------------ policy ---- */

/** Directives a component may extend through data-csp, and sources it may never add (inline scripts stay hash-only). */
const EXTENSIBLE = new Set([
  'script-src', 'style-src', 'style-src-attr', 'img-src', 'font-src', 'connect-src', 'frame-src', 'media-src',
  'worker-src',
]);
const FORBIDDEN = new Set(["'unsafe-eval'", '*', 'http:', 'https:']);
const FORBIDDEN_FOR_SCRIPTS = new Set(["'unsafe-inline'", "'unsafe-hashes'", "'strict-dynamic'", 'data:', 'blob:']);

export function parsePolicy(text: string): Map<string, string[]> {
  const policy = new Map<string, string[]>();
  for (const part of text.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name) policy.set(name.toLowerCase(), sources);
  }
  return policy;
}

export const serializePolicy = (policy: ReadonlyMap<string, readonly string[]>): string =>
  [...policy]
    .filter(([, sources]) => sources.length > 0)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');

/** A CSP hash source for `text`, e.g. 'sha256-…='. */
export const sha256 = (text: string): string =>
  `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** The page's policy: the site's, plus what its components declared, plus the hashes of what it has inline. */
export function pagePolicy(page: PageScan, site: Policy = SITE_POLICY): string {
  const policy = new Map(Object.entries(site).map(([name, sources]) => [name, [...sources]]));
  const add = (name: string, sources: readonly string[]) => {
    const list = policy.get(name) ?? [];
    for (const source of sources) if (!list.includes(source)) list.push(source);
    policy.set(name, list);
  };
  for (const extension of page.extensions) {
    for (const [name, sources] of parsePolicy(extension)) {
      if (!EXTENSIBLE.has(name)) throw new Error(`csp: data-csp can't change ${name}`);
      const bad = sources.find(
        (source) => FORBIDDEN.has(source) || (name === 'script-src' && FORBIDDEN_FOR_SCRIPTS.has(source)),
      );
      if (bad) throw new Error(`csp: data-csp can't add ${bad} to ${name}`);
      add(name, sources);
    }
  }
  const hashes = (texts: readonly string[]) => [...new Set(texts.map(sha256))];
  // A hash switches 'unsafe-inline' off in the same directive, so where a component asked for it, hashes stay out.
  const inline = (name: string) => policy.get(name)?.includes("'unsafe-inline'") ?? false;
  add('script-src', hashes(page.scripts));
  if (!inline('style-src')) add('style-src', hashes(page.styles));
  if (!inline('style-src-attr')) {
    if (page.styleAttrs.length > 0) add('style-src-attr', ["'unsafe-hashes'", ...hashes(page.styleAttrs)]);
    else if ((policy.get('style-src-attr') ?? []).length === 0) policy.set('style-src-attr', ["'none'"]);
  }
  return serializePolicy(policy);
}

/** The page with its policy as the first thing after <meta charset>; an earlier policy meta is replaced. */
export function applyCsp(html: string, site: Policy = SITE_POLICY): { html: string; policy: string } {
  const page = scanHtml(html);
  if (page.handlers.length) throw new Error(`csp: inline event handlers would be blocked: ${page.handlers.join(', ')}`);
  if (page.insertAt < 0) throw new Error('csp: <meta charset> must be the first element in <head>');
  const policy = pagePolicy(page, site);
  // An earlier policy meta can only follow <meta charset> (that has to come first), so removing it, last first,
  // leaves the insertion point where it is.
  let out = html;
  for (const { start, end } of [...page.metas].reverse()) out = out.slice(0, start) + out.slice(end);
  const content = policy.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${content}">`;
  return { html: out.slice(0, page.insertAt) + meta + out.slice(page.insertAt), policy };
}

/* ------------------------------------------------------------------ integration ---- */

export default function csp({ policy = SITE_POLICY }: { policy?: Policy } = {}): AstroIntegration {
  return {
    name: 'csp',
    hooks: {
      // Only pages Astro rendered: files copied from public/ (the CMS at /admin/, old-URL redirects) are left alone.
      'astro:build:done': async ({ assets, logger }) => {
        const files = new Set([...assets.values()].flat().map((url) => fileURLToPath(url)));
        const pages = [...files].filter((file) => file.endsWith('.html'));
        let largest = 0;
        await Promise.all(
          pages.map(async (file) => {
            try {
              const result = applyCsp(await readFile(file, 'utf8'), policy);
              largest = Math.max(largest, result.policy.length);
              await writeFile(file, result.html);
            } catch (error) {
              throw new Error(`${file}: ${(error as Error).message}`, { cause: error });
            }
          }),
        );
        logger.info(`Content-Security-Policy added to ${pages.length} page(s); largest policy ${largest} characters`);
      },
    },
  };
}
