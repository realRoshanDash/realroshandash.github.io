#!/usr/bin/env node
// @ts-check
/**
 * Seals the contact card: encrypts the contact details into src/data/contact.sealed.json behind a
 * proof-of-work. The format and threat model are documented in src/lib/contact/seal.ts, which
 * this script shares with the browser. Node built-ins only.
 *
 *   npm run seal-contact -- --email you@example.com [--phone "+65 9123 4567"] [--difficulty 22]
 *
 * Contact details come from the FIRST source that is present. Sources are never merged, so a field
 * left in another source cannot slip into the card unnoticed:
 *   1. flags          --email --phone --telegram --whatsapp --signal --calendar --note
 *   2. $CONTACT_JSON  e.g. CONTACT_JSON='{"email":"you@example.com"}' (handy as a CI secret)
 *   3. ./contact.local.json (gitignored)
 *
 * Difficulty calibration: 2026-11-07, Intel i7-1185G7 laptop (4 cores / 8 threads), Node 24.22,
 * headless Chromium 156, built site. Best of 3 runs over two passes. Other jobs were running,
 * so read the numbers as conservative.
 *   kernel, one thread               Node 2.6–3.6 MH/s, Chromium worker 2.7 MH/s (clock-dependent)
 *   Chromium, 1 / 2 / 4 / 8 workers  2.7 / 4.7 / 7.0 / 7.1 MH/s (hyper-threading adds ~nothing)
 *   Chromium main-thread fallback    2.4 MH/s
 *   solve(), 12 random cards each    d=22: mean 0.40–0.49 s, max 0.74 s; d=23: mean 0.76–0.90 s, max 1.48 s
 * A mid-range phone is assumed to be 4–6× slower, i.e. ~1.2–1.75 MH/s. At d = 22 (2^21 ≈ 2.1M
 * hashes expected, 2× that in the worst case) it hashes for ~1.2–1.8 s, plus worker start-up.
 * This desktop takes ~0.4 s. d = 23 would push phones to ~2.4–3.5 s.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const LOCAL_FILE = resolve(ROOT, 'contact.local.json');
const DEFAULT_OUT = resolve(ROOT, 'src/data/contact.sealed.json');
const DEFAULT_DIFFICULTY = 22;
/** Hashes per second from the calibration above, used only for the printed time estimates. */
const DESKTOP_RATE = 7e6;
const PHONE_RATE = DESKTOP_RATE / 5;

const USAGE = `Usage: npm run seal-contact -- [contact flags] [--difficulty N] [--out FILE]

Contact details (first source present wins: flags, then $CONTACT_JSON, then ./contact.local.json):
  --email ADDRESS      required
  --phone NUMBER       international format, e.g. "+65 9123 4567"
  --telegram USER      username, @username or t.me link
  --whatsapp NUMBER    international number or wa.me link
  --signal USER        username like name.42, international number or signal.me link
  --calendar URL       https:// booking link
  --note TEXT          up to 280 characters of plain text

Options:
  --difficulty N       proof-of-work bits, 1–32 (default ${DEFAULT_DIFFICULTY})
  --out FILE           output path (default src/data/contact.sealed.json)
  -h, --help           show this help`;

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`seal-contact: ${message}`);
  process.exit(1);
}

if (!process.features.typescript) {
  fail('needs Node 24 (or ≥ 22.18) with TypeScript type stripping enabled to load src/lib/contact/seal.ts.');
}
const { CONTACT_FIELDS, ContactError, MAX_DIFFICULTY, MIN_DIFFICULTY, parseContact, sealContact } = await import(
  '../src/lib/contact/seal.ts'
);

const text = /** @type {const} */ ({ type: 'string' });
const options = {
  email: text, phone: text, telegram: text, whatsapp: text, signal: text, calendar: text, note: text,
  difficulty: text,
  out: text,
  help: /** @type {const} */ ({ type: 'boolean', short: 'h' }),
};
const args = (() => {
  try {
    return parseArgs({ options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    return fail(`${error instanceof Error ? error.message : error}\n\n${USAGE}`);
  }
})();
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const difficulty = args.difficulty === undefined ? DEFAULT_DIFFICULTY : Number(args.difficulty);
if (!/^\d+$/.test(String(args.difficulty ?? difficulty)) || difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY) {
  fail(`--difficulty must be an integer from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}.`);
}

/**
 * JSON.parse errors quote the input, which may hold the very secrets we are sealing, so only name the source.
 * @param {string} json @param {string} name @returns {unknown}
 */
function parseJson(json, name) {
  try {
    return JSON.parse(json);
  } catch {
    return fail(`${name} is not valid JSON.`);
  }
}

const flagged = Object.fromEntries(CONTACT_FIELDS.filter((f) => args[f] !== undefined).map((f) => [f, args[f]]));
const envJson = process.env.CONTACT_JSON?.trim() ? process.env.CONTACT_JSON : undefined;
const localName = relative(process.cwd(), LOCAL_FILE) || 'contact.local.json';
const hasLocal = existsSync(LOCAL_FILE);
/** @type {[string, unknown]} */
const [source, input] =
  Object.keys(flagged).length > 0
    ? ['command-line flags', flagged]
    : envJson !== undefined
      ? ['$CONTACT_JSON', parseJson(envJson, '$CONTACT_JSON')]
      : hasLocal
        ? [localName, parseJson(readFileSync(LOCAL_FILE, 'utf8'), localName)]
        : fail(`no contact details: pass --email …, set $CONTACT_JSON or create ${localName}.\n\n${USAGE}`);
const ignored = [
  source !== '$CONTACT_JSON' && envJson !== undefined && '$CONTACT_JSON',
  source !== localName && hasLocal && localName,
].filter(Boolean);

const sealed = await (async () => {
  try {
    return await sealContact(input, { difficulty });
  } catch (error) {
    if (error instanceof ContactError) fail(`invalid contact details in ${source}:\n  - ${error.issues.join('\n  - ')}`);
    throw error;
  }
})();

// Write atomically so an interrupted run never leaves a truncated card behind.
const out = args.out === undefined ? DEFAULT_OUT : resolve(args.out);
const shown = relative(process.cwd(), out);
const outName = shown && !shown.startsWith('..') ? shown : out;
const tmp = `${out}.${process.pid}.tmp`;
try {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(sealed, null, 2)}\n`);
  renameSync(tmp, out);
} catch (error) {
  try {
    rmSync(tmp, { force: true });
  } catch {
    // Best effort: the error below is the one that matters.
  }
  fail(`could not write ${outName}: ${error instanceof Error ? error.message : error}`);
}

// Summary. Values are masked so that CI logs never show them in full.
/** @type {Record<string, (value: string) => string>} */
const MASK = {
  email: (v) => `${v[0]}…${v.slice(v.lastIndexOf('@'))}`,
  phone: (v) => `${v.slice(0, 3)}…${v.slice(-2)}`,
  whatsapp: (v) => `${v.slice(0, 3)}…${v.slice(-2)}`,
  telegram: (v) => `${v[0]}…${v.slice(-1)}`,
  signal: (v) => (v.startsWith('https://') ? `${new URL(v).origin}/…` : `${v[0]}…${v.slice(-1)}`),
  calendar: (v) => `${new URL(v).origin}/…`,
  note: (v) => `(${[...v].length} characters)`,
};
/** @param {number} hashes @param {number} rate */
const seconds = (hashes, rate) => {
  const s = hashes / rate;
  return s < 0.1 ? '<0.1 s' : s < 10 ? `~${s.toFixed(1)} s` : s < 120 ? `~${Math.round(s)} s` : `~${Math.round(s / 60)} min`;
};
/** @param {number} n */
const count = (n) => (n >= 1e6 ? `${+(n / 1e6).toPrecision(2)}M` : n >= 1e3 ? `${+(n / 1e3).toPrecision(2)}K` : `${n}`);
const expected = 2 ** (difficulty - 1);
const rows = [
  ['source', source + (ignored.length ? ` (ignored: ${ignored.join(', ')})` : '')],
  ...Object.entries(parseContact(input)).map(([field, value]) => [field, MASK[field](value)]),
  ['difficulty', `${difficulty} bits: ~${count(expected)} hashes expected, ${count(2 * expected)} worst case`],
  ['time', `${seconds(expected, DESKTOP_RATE)} desktop, ${seconds(expected, PHONE_RATE)} mid-range phone (expected; up to 2× worst case)`],
  ['created', sealed.createdAt],
];
console.log(`Sealed contact card → ${outName}`);
for (const [label, value] of rows) console.log(`  ${label.padEnd(11)} ${value}`);
if (difficulty < 16) console.warn('  warning: below 16 bits the puzzle is near-instant; it only stops scrapers that do not run JS.');
if (expected / PHONE_RATE > 5) console.warn('  warning: phones will take several seconds; consider a lower --difficulty.');
console.log('The nonce was discarded and nothing secret was written. Commit the sealed file.');
