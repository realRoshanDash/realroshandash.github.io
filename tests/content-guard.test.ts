/**
 * The content guard (scripts/content-guard.mjs) is the last step of `npm run build`: it must catch trading copy,
 * the private project, health details, the contact card's values in any encoding and any file (text, binary or
 * gzipped), an address on the domain and photos that carry a location, and let ordinary engineering words through.
 * Run: node --test tests/content-guard.test.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import sharp from 'sharp';
import { sealContact } from '../src/lib/contact/seal.ts';

const SCRIPT = new URL('../scripts/content-guard.mjs', import.meta.url).pathname;
const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  dirs.push(dir);
  return dir;
};

// A stand-in card, sealed at a low difficulty so each run opens it in milliseconds. Addresses are built at
// runtime, so no address-shaped string ever sits in the repo.
const SECRET = ['card.owner+site', 'example.org'].join('@');
const [LOCAL, DOMAIN] = SECRET.split('@');
let CARD = '';
before(async () => {
  CARD = join(scratch(), 'card.json');
  writeFileSync(CARD, JSON.stringify(await sealContact({ email: SECRET }, { difficulty: 8 })));
});

/** Runs the guard over a fresh directory holding `files`, with the stand-in card. */
function guard(files: Record<string, string | Buffer>, card: string | null = CARD) {
  const dir = scratch();
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  const run = spawnSync(process.execPath, [SCRIPT, ...(card ? ['--card', card] : []), dir], { encoding: 'utf8' });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('content guard', () => {
  test('passes professional copy, engineering "trade-offs", Thread.sleep, the masked address and binaries', () => {
    const { code, out } = guard({
      'index.html': '<p>Every design is a trade-off; tradeoffs and trade-offs are fine. Marketing pages too.</p><dd>••••••••@<wbr>roshandash.com</dd>',
      'feed.xml': '<title>Writing · Roshan Dash</title>',
      'app.js': 'await Thread.sleep(100); // stock config, shared cache',
      'image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x74, 0x72, 0x61, 0x64, 0x65]), // binary containing "trade"
    });
    assert.equal(code, 0, out);
    assert.match(out, /1 contact card value/);
  });

  test('fails on trading copy in any text file, whatever its type', () => {
    for (const [name, body] of [
      ['rss.xml', '<title>Trade Ideas · Roshan Dash</title>'],
      ['config.yml', 'options: [NASDAQ, NYSE]'],
      ['notes.xml', '<description>markets, links and things learned</description>'],
      ['card.json', '{"line":"the setup, entry, stop and targets in R"}'],
      ['app.js', 'const label = "TradingView symbol";'],
      ['post.html', '<p>I check the stock prices on my watch.</p>'],
      ['about.txt', `I run ${Buffer.from('bmV4dXM=', 'base64').toString()}`], // the private project, encoded as in the guard
    ]) {
      const { code, out } = guard({ [name]: body });
      assert.equal(code, 1, `${name} should fail:\n${out}`);
    }
  });

  test('fails on health details', () => {
    for (const body of ['<p>I use it to monitor my workouts.</p>', '<p>charging it while napping</p>', '<p>my heart rate</p>']) {
      assert.equal(guard({ 'post.html': body }).code, 1, body);
    }
  });

  test('fails on an address on the domain, with "@" in any encoding, and on a mailto: link in markup', () => {
    const address = (at: string) => ['someone', 'roshandash.com'].join(at);
    for (const [name, body] of [
      ['a.html', `<p>${address('@')}</p>`],
      ['b.html', `<a href="/x?to=${address('%40')}">x</a>`],
      ['c.html', `<p>${address('&#64;')}</p>`],
      ['d.html', `<p>${address('&#x40;')}</p>`],
      ['e.js', `const to = "${address('\\x40')}";`],
      ['f.js', `const to = "${address('\\u0040')}";`],
      ['g.json', `{"to":"${address('%2540')}"}`],
    ]) {
      const { code, out } = guard({ [name]: body });
      assert.equal(code, 1, `${name} should fail:\n${out}`);
      assert.doesNotMatch(out, /someone/, 'the address is withheld from the log');
    }
    assert.equal(guard({ 'b.html': '<a href="mailto:x">x</a>' }).code, 1);
    assert.equal(guard({ 'c.js': 'const href = `mailto:${value}`;' }).code, 0);
  });

  test("finds the card's own value anywhere, on any domain and in any encoding, and never prints it", () => {
    const encoded = (at: string) => `${LOCAL}${at}${DOMAIN}`;
    const cases: Record<string, string | Buffer> = {
      'plain.html': `<p>${SECRET}</p>`,
      'upper.txt': SECRET.toUpperCase(),
      'pct.html': `<a href="?to=${encoded('%40')}">x</a>`,
      'double.json': `{"u":"${encoded('%2540')}"}`,
      'dec.html': `<p>${encoded('&#64;')}</p>`,
      'hex.html': `<p>${encoded('&#x40;')}</p>`,
      'named.html': `<p>${encoded('&commat;')}</p>`,
      'esc.js': `"${encoded('\\x40')}"`,
      'uni.js': `"${encoded('\\u0040')}"`,
      'plus.html': `<p>${SECRET.replace('+', '%2B')}</p>`,
      // binary files are scanned too: an image's metadata, a font, the compressed search index
      'meta.jpg': Buffer.concat([Buffer.from([0xff, 0xd8, 0x00, 0x00]), Buffer.from(SECRET), Buffer.from([0xff, 0xd9])]),
      'utf16.bin': Buffer.concat([Buffer.from([0x00, 0x00]), Buffer.from(SECRET, 'utf16le')]),
      'en_1.pf_fragment': gzipSync(`pagefind_dcd{"content":"write to ${SECRET} today"}`),
    };
    for (const [name, body] of Object.entries(cases)) {
      const { code, out } = guard({ [name]: body });
      assert.equal(code, 1, `${name} should fail:\n${out}`);
      assert.match(out, /\[contact card: email\] \(value withheld\)/, name);
      assert.ok(!out.toLowerCase().includes(LOCAL.toLowerCase()), `${name}: the value must not reach the log`);
    }
    // other text on the same domain is no contact value
    assert.equal(guard({ 'ok.html': `<p>${['someone.else', DOMAIN].join('@')}</p>` }).code, 0);
  });

  test("opens the site's own sealed card when no other is given", () => {
    const { code, out } = guard({ 'ok.html': '<p>Hello</p>' }, null);
    assert.equal(code, 0, out);
    assert.match(out, /[1-9] contact card value/);
  });

  test("the policy's form-action mailto: source is not a link, but a mailto: link right after it still is", () => {
    const meta = `<meta http-equiv="Content-Security-Policy" content="form-action 'self' mailto:; base-uri 'self'">`;
    assert.equal(guard({ 'a.html': meta }).code, 0);
    assert.equal(guard({ 'b.html': `<meta http-equiv="Content-Security-Policy" content="form-action 'self' mailto:">` }).code, 0);
    assert.equal(guard({ 'c.html': `${meta}<a href="mailto:?subject=hi">x</a>` }).code, 1);
    assert.equal(guard({ 'd.html': '<a href="mailto:&#120;">x</a>' }).code, 1); // an entity-encoded address
  });

  test('fails on a photo whose EXIF carries a GPS location, and passes one without', async () => {
    // a minimal TIFF EXIF block: IFD0 with one GPSInfo pointer → a GPS IFD with one entry (GPSVersionID)
    const tiff = Buffer.alloc(44);
    tiff.write('II', 0, 'latin1');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4); // IFD0 at 8
    tiff.writeUInt16LE(1, 8); // one entry
    tiff.writeUInt16LE(0x8825, 10); // GPSInfo
    tiff.writeUInt16LE(4, 12); // LONG
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt32LE(26, 18); // GPS IFD at 26
    tiff.writeUInt32LE(0, 22); // no next IFD
    tiff.writeUInt16LE(1, 26); // GPS IFD: one entry
    tiff.writeUInt16LE(0x0000, 28); // GPSVersionID
    tiff.writeUInt16LE(1, 30); // BYTE
    tiff.writeUInt32LE(4, 32);
    tiff.writeUInt8(2, 36); // 2.2.0.0
    tiff.writeUInt8(2, 37);
    const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const pixels = { create: { width: 8, height: 8, channels: 3 as const, background: '#808080' } };
    const clean = await sharp(pixels).jpeg().toBuffer();
    // the EXIF goes in as the JPEG's APP1 segment, straight after the SOI marker
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), exif]);
    app1.writeUInt16BE(exif.length + 2, 2);
    const withGps = Buffer.concat([clean.subarray(0, 2), app1, clean.subarray(2)]);
    const gps = guard({ 'photo.jpg': withGps });
    assert.equal(gps.code, 1, gps.out);
    assert.match(gps.out, /\[photo location\]/);
    const ok = guard({ 'photo.jpg': clean });
    assert.equal(ok.code, 0, ok.out);
  });
});
