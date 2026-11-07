/**
 * The content guard (scripts/content-guard.mjs) is the last step of `npm run build`: it must catch trading copy,
 * the private project and a plaintext address in any served text file, and let ordinary engineering words through.
 * Run: node --test tests/content-guard.test.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

const SCRIPT = new URL('../scripts/content-guard.mjs', import.meta.url).pathname;
const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Runs the guard over a fresh directory holding `files`. */
function guard(files: Record<string, string | Buffer>) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  const run = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('content guard', () => {
  test('passes professional copy, engineering "trade-offs", the masked address and binaries', () => {
    const { code, out } = guard({
      'index.html': '<p>Every design is a trade-off; tradeoffs and trade-offs are fine. Marketing pages too.</p><dd>••••••••@roshandash.com</dd>',
      'feed.xml': '<title>Writing · Roshan Dash</title>',
      'image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x74, 0x72, 0x61, 0x64, 0x65]), // binary containing "trade"
    });
    assert.equal(code, 0, out);
  });

  test('fails on trading copy in any text file, whatever its type', () => {
    for (const [name, body] of [
      ['rss.xml', '<title>Trade Ideas · Roshan Dash</title>'],
      ['config.yml', "options: [NASDAQ, NYSE]"],
      ['notes.xml', '<description>markets, links and things learned</description>'],
      ['card.json', '{"line":"the setup, entry, stop and targets in R"}'],
      ['app.js', 'const label = "TradingView symbol";'],
      ['about.txt', `I run ${Buffer.from('bmV4dXM=', 'base64').toString()}`], // the private project, encoded as in the guard
    ]) {
      const { code, out } = guard({ [name]: body });
      assert.equal(code, 1, `${name} should fail:\n${out}`);
    }
  });

  test('fails on a plaintext address or a mailto: link in markup, but not on mailto: in a script', () => {
    // built at runtime, so no address-shaped string ever sits in the repo
    const address = ['someone', 'roshandash.com'].join('@');
    assert.equal(guard({ 'a.html': `<p>${address}</p>` }).code, 1);
    assert.equal(guard({ 'b.html': '<a href="mailto:x">x</a>' }).code, 1);
    assert.equal(guard({ 'c.js': 'const href = `mailto:${value}`;' }).code, 0);
  });
});
