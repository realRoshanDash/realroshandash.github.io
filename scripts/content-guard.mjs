#!/usr/bin/env node
/**
 * Content guard: fails the build if anything the site serves breaks the owner's content rules.
 * The site is professional only: no trading, markets or tickers, nothing about the owner's private project, no
 * health details, and the contact details are never in the served files (the contact card ships them only as
 * ciphertext).
 *
 *   node scripts/content-guard.mjs                        # scans dist/ (after a build) and public/
 *   node scripts/content-guard.mjs some/dir …             # scans the given directories instead
 *   node scripts/content-guard.mjs --card card.json dir   # with another sealed card (tests)
 *
 * `npm run build` runs it last, so CI fails before a bad build can deploy. Three checks:
 *
 * 1. Copy rules, on every text file whatever its type (HTML, XML feeds, YAML, JSON, JS, CSS, TXT…) and on the
 *    decompressed text of gzipped files (Pagefind's search fragments).
 * 2. The contact card's own values. The guard opens src/data/contact.sealed.json exactly as a visitor's browser
 *    does (about a second of proof-of-work) and looks for each value in every file, text or binary, plain or
 *    decompressed, with "@" written plainly or %40, %2540, &#64;, &#x40;, &commat;, \x40 or @ encoded. The
 *    values are never printed: CI logs are public.
 * 3. Photos: a served image, or one committed under src/ or public/, whose EXIF carries a GPS location.
 *
 * To publish something these rules block (e.g. if the owner ever opts in to trade ideas), change the rule here in
 * the same commit, so the decision is on record.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');

// The private project's name and host, base64-encoded so they don't appear in this public repository either.
const PRIVATE = ['bmV4dXM=', 'YXBwLnJvc2hhbmRhc2guY29t'].map((b64) => Buffer.from(b64, 'base64').toString('utf8'));
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "@" as markup, URLs and string literals can write it. */
const AT = String.raw`(?:@|%40|%2540|&#0*64;|&#x0*40;|&commat;|\\x40|\\u0040|\\u\{0*40\})`;

const RULES = [
  {
    name: 'trading',
    // "trade-off(s)" and "tradeoff" are engineering words, not trading, so they pass.
    re: /\btrad(?:e|es|er|ers|ing)\b(?!-?offs?\b)|tradingview|\btickers?\b|\bnyse\b|\bnasdaq\b|\bequit(?:y|ies)\b|\bmarkets?\b|\bstock ?prices?\b|\bshare prices?\b|financial advice|targets in r\b|\br-multiples?\b|candlestick/gi,
  },
  { name: 'private project', re: new RegExp(PRIVATE.map((word) => `\\b${escapeRe(word)}\\b`).join('|'), 'gi') },
  // Words that only a health or fitness detail would use ("sleep" stays allowed: Thread.sleep is engineering).
  { name: 'health', re: /\bwork-?outs?\b|\bnapping\b|\bheart[- ]rate\b|\bblood (?:pressure|sugar)\b|\bcalories\b/gi },
  // Any real-looking address on the domain, "@" encoded or not (the masked "••••••••@roshandash.com" has no local part).
  { name: 'email address', re: new RegExp(String.raw`[a-z0-9._%+-]+${AT}roshandash\.com`, 'gi') },
  // Markup never links to an address: the contact card builds its mailto: link in the browser after the proof-of-work.
  // A bare "mailto:" (the Content-Security-Policy's form-action source, followed by ";" or a quote) is no link.
  { name: 'mailto link', re: /mailto:(?![\s;"']|$)/gi, only: /\.(?:html?|xml)$/i },
];

const { values: flags, positionals } = parseArgs({ options: { card: { type: 'string' } }, allowPositionals: true });
const roots = positionals.length ? positionals : ['dist', 'public'];
/** Where committed photos live, checked for GPS data too (on a default run). */
const photoRoots = positionals.length ? positionals : [...roots, 'src'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

/** Like grep -I: a NUL byte in the first 8 KB means binary (images, fonts, compressed search index). */
const isBinary = (buffer) => buffer.subarray(0, 8192).includes(0);
const isGzip = (buffer) => buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

/* ------------------------------------------------------------------ the card's values ---- */

/**
 * Opens the sealed card with its own proof-of-work, as the gate does in the browser, and returns a pattern per
 * value (field name only: never the value). A card that can't be opened fails the guard: it is the site's.
 */
async function cardPatterns(path) {
  if (!process.features.typescript) {
    throw new Error('needs Node 24 (or ≥ 22.18) with TypeScript type stripping to open the contact card');
  }
  const { createPowSearch, decodeSealed, parseSealed, unsealContact } = await import('../src/lib/contact/seal.ts');
  const sealed = parseSealed(JSON.parse(readFileSync(path, 'utf8')));
  const { salt, check } = decodeSealed(sealed);
  const nonce = createPowSearch(salt, check).scan(0, 2 ** sealed.difficulty);
  if (nonce < 0) throw new Error('the contact card has no solution (tampered salt or check)');
  const contact = await unsealContact(sealed, nonce);
  return Object.entries(contact)
    .filter(([, value]) => typeof value === 'string' && value.length >= 6)
    .map(([field, value]) => ({
      field,
      re: new RegExp(value.split('@').map(escapeRe).join(AT).replace(/\\\+/g, '(?:\\+|%2B|&#0*43;|&#x0*2b;)'), 'i'),
    }));
}

const cardPath = flags.card ? resolve(flags.card) : join(ROOT, 'src/data/contact.sealed.json');
const card = existsSync(cardPath) ? await cardPatterns(cardPath) : [];
if (!card.length) console.warn(`content guard: no contact card at ${relative('.', cardPath)}, so its values aren't checked`);

/* ------------------------------------------------------------------ photos ---- */

const PHOTO = /\.(?:jpe?g|png|webp|avif|tiff?|heic|heif)$/i;

/** Whether an EXIF block (as sharp returns it, "Exif\0\0" + TIFF) has a GPS IFD with any entries in it. */
export function exifHasGps(exif) {
  try {
    const at = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
    const order = exif.subarray(at, at + 2).toString('latin1');
    if (order !== 'II' && order !== 'MM') return false;
    const le = order === 'II';
    const u16 = (i) => (le ? exif.readUInt16LE(at + i) : exif.readUInt16BE(at + i));
    const u32 = (i) => (le ? exif.readUInt32LE(at + i) : exif.readUInt32BE(at + i));
    const ifd0 = u32(4);
    for (let k = 0, n = u16(ifd0); k < n; k++) {
      const entry = ifd0 + 2 + 12 * k;
      if (u16(entry) === 0x8825) return u16(u32(entry + 8)) > 0; // GPSInfo → the GPS IFD's entry count
    }
    return false;
  } catch {
    return false; // truncated or malformed: no location to read either
  }
}

let sharp;
async function hasGps(path) {
  sharp ??= (await import('sharp')).default;
  try {
    const { exif } = await sharp(path).metadata();
    return Boolean(exif && exifHasGps(exif));
  } catch {
    return false; // not an image sharp can read
  }
}

/* ------------------------------------------------------------------ scanning ---- */

const hits = [];
let scanned = 0;

function scanText(file, text) {
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(file)) continue;
      for (const match of line.matchAll(rule.re)) {
        const at = match.index ?? 0;
        const context = line.slice(Math.max(0, at - 40), at + match[0].length + 40).trim();
        // an address on the domain is withheld like the card's: it is the reason this rule exists
        const shown = rule.name === 'email address' ? '(withheld)' : `"${match[0]}"  …${context}…`;
        hits.push(`${file}:${i + 1}  [${rule.name}] ${shown}`);
      }
    }
    for (const { field, re } of card) if (re.test(line)) hits.push(`${file}:${i + 1}  [contact card: ${field}] (value withheld)`);
  });
}

function scanBinary(file, buffer) {
  // ASCII as UTF-8 or Latin-1 bytes, and as UTF-16 at either byte offset
  const views = [buffer.toString('latin1'), buffer.toString('utf16le'), buffer.subarray(1).toString('utf16le')];
  for (const { field, re } of card) if (views.some((view) => re.test(view))) hits.push(`${file}  [contact card: ${field}] (value withheld)`);
}

function scan(file, buffer) {
  if (isBinary(buffer)) scanBinary(file, buffer);
  else scanText(file, buffer.toString('utf8'));
  if (isGzip(buffer)) {
    let inflated;
    try {
      inflated = gunzipSync(buffer);
    } catch {
      return;
    }
    scan(`${file} (gunzipped)`, inflated);
  }
}

for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const file of files(root)) {
    scanned++;
    scan(relative('.', file), readFileSync(file));
  }
}

let photos = 0;
for (const root of new Set(photoRoots)) {
  if (!existsSync(root)) continue;
  for (const file of files(root)) {
    if (!PHOTO.test(file) || file.split(/[\\/]/).includes('node_modules')) continue;
    photos++;
    if (await hasGps(file)) hits.push(`${relative('.', file)}  [photo location] EXIF has GPS data: strip it before committing (e.g. exiftool -gps:all= file)`);
  }
}

if (hits.length) {
  console.error(`content guard: ${hits.length} problem(s) in ${scanned} files\n`);
  for (const hit of hits.slice(0, 50)) console.error(`  ${hit}`);
  if (hits.length > 50) console.error(`  … and ${hits.length - 50} more`);
  process.exit(1);
}
console.log(
  `content guard: ${scanned} files in ${roots.join(', ')} (text, binary and gunzipped), ${card.length} contact card value(s), ` +
    `${photos} photo(s) for GPS data: no problems`,
);
