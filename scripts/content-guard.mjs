#!/usr/bin/env node
/**
 * Content guard: fails the build if anything the site serves breaks the owner's content rules.
 * The site is professional only: no trading, markets or tickers, nothing about the owner's private project, and the
 * email address is never in the served files (the contact card ships it only as ciphertext).
 *
 *   node scripts/content-guard.mjs            # scans dist/ (after a build) and public/
 *   node scripts/content-guard.mjs some/dir   # scans the given directories instead
 *
 * `npm run build` runs it last, so CI fails before a bad build can deploy. Every text file is scanned,
 * whatever its type (HTML, XML feeds, YAML, JSON, JS, CSS, TXT…); binary files are skipped.
 * To publish something these rules block (e.g. if the owner ever opts in to trade ideas), change the
 * rule here in the same commit, so the decision is on record.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The private project's name and host, base64-encoded so they don't appear in this public repository either.
const PRIVATE = ['bmV4dXM=', 'YXBwLnJvc2hhbmRhc2guY29t'].map((b64) => Buffer.from(b64, 'base64').toString('utf8'));
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const RULES = [
  {
    name: 'trading',
    // "trade-off(s)" and "tradeoff" are engineering words, not trading, so they pass.
    re: /\btrad(?:e|es|er|ers|ing)\b(?!-?offs?\b)|tradingview|\btickers?\b|\bnyse\b|\bnasdaq\b|\bequit(?:y|ies)\b|\bmarkets?\b|financial advice|targets in r\b|\br-multiples?\b|candlestick/gi,
  },
  { name: 'private project', re: new RegExp(PRIVATE.map((word) => `\\b${escapeRe(word)}\\b`).join('|'), 'gi') },
  // Any real-looking address on the domain (the masked "••••••••@roshandash.com" has no local part).
  { name: 'email address', re: /[a-z0-9._%+-]+@roshandash\.com/gi },
  // Markup never links to an address: the contact card builds its mailto: link in the browser after the proof-of-work.
  // A bare "mailto:" (the Content-Security-Policy's form-action source, followed by ";" or a quote) is no link.
  { name: 'mailto link', re: /mailto:(?![\s;"']|$)/gi, only: /\.(?:html?|xml)$/i },
];

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['dist', 'public'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

/** Like grep -I: a NUL byte in the first 8 KB means binary (images, fonts, compressed search index). */
const isBinary = (buffer) => buffer.subarray(0, 8192).includes(0);

const hits = [];
let scanned = 0;
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const file of files(root)) {
    const buffer = readFileSync(file);
    if (isBinary(buffer)) continue;
    scanned++;
    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.only && !rule.only.test(file)) continue;
        for (const match of line.matchAll(rule.re)) {
          const at = match.index ?? 0;
          const context = line.slice(Math.max(0, at - 40), at + match[0].length + 40).trim();
          hits.push(`${relative('.', file)}:${i + 1}  [${rule.name}] "${match[0]}"  …${context}…`);
        }
      }
    });
  }
}

if (hits.length) {
  console.error(`content guard: ${hits.length} problem(s) in ${scanned} text files\n`);
  for (const hit of hits.slice(0, 50)) console.error(`  ${hit}`);
  if (hits.length > 50) console.error(`  … and ${hits.length - 50} more`);
  process.exit(1);
}
console.log(`content guard: ${scanned} text files in ${roots.join(', ')}, no problems`);
