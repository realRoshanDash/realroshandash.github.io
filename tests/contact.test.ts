/**
 * Sealed contact card: kernel, format, tamper resistance, validation and the solver (main-thread
 * path, plus the real worker file driven through a worker_threads-backed `Worker` shim).
 * Run: node --test tests/contact.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { Worker as ThreadWorker } from 'node:worker_threads';
import {
  ContactError,
  createPowSearch,
  decodeSealed,
  parseContact,
  parseSealed,
  powDigest,
  sealContact,
  unsealContact,
  type SealedContact,
} from '../src/lib/contact/seal.ts';
import { solve, verify, type SolveProgress } from '../src/scripts/contact/solver.ts';
import type { PowResponse } from '../src/scripts/contact/pow.worker.ts';

const CONTACT = {
  email: 'Someone@Example.COM',
  phone: '+65 9123-4567',
  telegram: '@some_one',
  calendar: 'https://cal.example.com/someone/30min',
  note: 'DMs open for trading chat.',
};
const NORMALISED = {
  email: 'Someone@example.com',
  phone: '+6591234567',
  telegram: 'some_one',
  calendar: 'https://cal.example.com/someone/30min',
  note: 'DMs open for trading chat.',
};

const message = (salt: Uint8Array, domain: number, nonce: number): Buffer => {
  const m = Buffer.alloc(21);
  m.set(salt);
  m[16] = domain;
  m.writeUInt32BE(nonce, 17);
  return m;
};
const sha256 = (data: Uint8Array): Buffer => createHash('sha256').update(data).digest();
const isCode = (code: string) => (error: unknown) => error instanceof ContactError && error.code === code;
/** A copy of a card with one base64 field's byte flipped. */
const flip = (sealed: SealedContact, field: 'salt' | 'iv' | 'ct', index = 0): SealedContact => {
  const bytes = Buffer.from(sealed[field], 'base64');
  bytes[index] ^= 0x01;
  return { ...sealed, [field]: bytes.toString('base64') } as SealedContact;
};
const EDGE_NONCES = [0, 1, 255, 256, 257, 0xffff, 0x10000, 0xffffff, 0x1000000, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 256, 2 ** 32 - 2, 2 ** 32 - 1];

describe('SHA-256 kernel', () => {
  it('powDigest matches node:crypto on random inputs', () => {
    for (let i = 0; i < 3000; i++) {
      const salt = randomBytes(16);
      const domain = randomInt(256);
      const nonce = EDGE_NONCES[i] ?? randomInt(2 ** 32);
      assert.deepEqual(Buffer.from(powDigest(salt, domain, nonce)), sha256(message(salt, domain, nonce)), `nonce ${nonce}`);
    }
  });

  it('scan finds the nonce exactly, at word, byte and sign boundaries', () => {
    for (let i = 0; i < 200; i++) {
      const salt = randomBytes(16);
      const nonce = EDGE_NONCES[i] ?? randomInt(2 ** 32);
      const search = createPowSearch(salt, sha256(message(salt, 1, nonce)));
      const lo = Math.max(0, nonce - randomInt(1, 600));
      const hi = Math.min(2 ** 32, nonce + randomInt(1, 600));
      assert.equal(search.scan(lo, hi), nonce, `nonce ${nonce} in [${lo}, ${hi})`);
      assert.equal(search.scan(nonce, nonce + 1), nonce);
      assert.equal(search.scan(lo, nonce), -1);
      assert.equal(search.scan(nonce + 1, hi), -1);
    }
  });

  it('scan handles unaligned, single and empty ranges', () => {
    const salt = randomBytes(16);
    const nonce = 0x12345;
    const search = createPowSearch(salt, sha256(message(salt, 1, nonce)));
    for (const [start, end] of [[nonce, nonce + 1], [nonce - 0x45, nonce + 1], [nonce - 0x46, nonce + 0xbb], [nonce - 300, nonce + 300], [0x12300, 0x12400]]) {
      assert.equal(search.scan(start, end), nonce, `[${start}, ${end})`);
    }
    for (const [start, end] of [[nonce, nonce], [nonce + 1, nonce], [nonce + 1, nonce + 0xbb], [0x12200, 0x12345], [0x12346, 0x12500]]) {
      assert.equal(search.scan(start, end), -1, `[${start}, ${end})`);
    }
  });

  it('rejects near-misses that only differ outside the early-exit word', () => {
    const salt = randomBytes(16);
    const nonce = randomInt(1000, 2 ** 32 - 1000);
    const check = sha256(message(salt, 1, nonce));
    // Same H7, so the early exit passes and only the full-digest confirmation can reject it.
    const firstWordOff = Buffer.from(check);
    firstWordOff[0] ^= 0x80;
    assert.equal(createPowSearch(salt, firstWordOff).scan(nonce - 1000, nonce + 1000), -1);
    const lastWordOff = Buffer.from(check);
    lastWordOff[31] ^= 0x01;
    assert.equal(createPowSearch(salt, lastWordOff).scan(nonce - 1000, nonce + 1000), -1);
  });

  it('validates its inputs', () => {
    assert.throws(() => createPowSearch(new Uint8Array(15), new Uint8Array(32)), RangeError);
    assert.throws(() => createPowSearch(new Uint8Array(16), new Uint8Array(31)), RangeError);
  });
});

describe('seal / unseal', () => {
  it('writes the documented format, readable with node:crypto alone', async () => {
    const nonce = 0x2a5f1;
    const sealed = await sealContact(CONTACT, { difficulty: 20, nonce, now: new Date('2026-01-02T03:04:05Z') });
    assert.deepEqual(Object.keys(sealed), ['v', 'alg', 'difficulty', 'salt', 'check', 'iv', 'ct', 'createdAt']);
    assert.equal(sealed.v, 1);
    assert.equal(sealed.alg, 'AES-256-GCM');
    assert.equal(sealed.difficulty, 20);
    assert.equal(sealed.createdAt, '2026-01-02T03:04:05.000Z');
    const salt = Buffer.from(sealed.salt, 'base64');
    const iv = Buffer.from(sealed.iv, 'base64');
    const ct = Buffer.from(sealed.ct, 'base64');
    assert.equal(salt.length, 16);
    assert.equal(iv.length, 12);
    assert.match(sealed.check, /^[0-9a-f]{64}$/);
    assert.equal(sealed.check, sha256(message(salt, 0x01, nonce)).toString('hex'));
    const decipher = createDecipheriv('aes-256-gcm', sha256(message(salt, 0x02, nonce)), iv);
    decipher.setAuthTag(ct.subarray(-16));
    const plaintext = Buffer.concat([decipher.update(ct.subarray(0, -16)), decipher.final()]).toString('utf8');
    assert.deepEqual(JSON.parse(plaintext), NORMALISED);
    assert.deepEqual(parseSealed(JSON.parse(JSON.stringify(sealed))), sealed);
  });

  it('round-trips through solve() at small difficulties', async () => {
    for (const difficulty of [1, 2, 3, 8, 12, 16]) {
      const sealed = await sealContact(CONTACT, { difficulty });
      const result = await solve(JSON.parse(JSON.stringify(sealed)), { workers: 0 });
      assert.deepEqual(result.contact, NORMALISED);
      assert.ok(result.nonce >= 0 && result.nonce < 2 ** difficulty);
      assert.equal(result.hashes, result.nonce + 1);
      assert.ok(result.ms >= 0);
    }
  });

  it('opens at both ends of the nonce range, up to difficulty 32', async () => {
    for (const nonce of [0, 2 ** 12 - 1]) {
      const sealed = await sealContact(CONTACT, { difficulty: 12, nonce });
      assert.equal((await solve(sealed, { workers: 0 })).nonce, nonce);
    }
    const top = 2 ** 32 - 1;
    const sealed = await sealContact(CONTACT, { difficulty: 32, nonce: top });
    const { salt, check } = decodeSealed(sealed);
    assert.equal(createPowSearch(salt, check).scan(2 ** 32 - 5000, 2 ** 32), top);
    assert.deepEqual(await unsealContact(sealed, top), NORMALISED);
  });

  it('rejects bad difficulties and nonces', async () => {
    for (const difficulty of [0, 33, 1.5, Number.NaN, -1, '8']) {
      await assert.rejects(sealContact(CONTACT, { difficulty: difficulty as number }), RangeError);
    }
    for (const nonce of [-1, 2 ** 8, 1.5]) {
      await assert.rejects(sealContact(CONTACT, { difficulty: 8, nonce }), RangeError);
    }
    const sealed = await sealContact(CONTACT, { difficulty: 8 });
    for (const difficulty of [0, 33, 1.5, '8', null]) {
      assert.throws(() => parseSealed({ ...sealed, difficulty }), isCode('invalid-sealed'));
    }
  });

  it('fails cleanly on a wrong nonce or tampered data', async () => {
    const nonce = 777;
    const sealed = await sealContact(CONTACT, { difficulty: 10, nonce });
    await assert.rejects(unsealContact(sealed, nonce + 1), isCode('decrypt-failed'));
    await assert.rejects(unsealContact(flip(sealed, 'ct', 3), nonce), isCode('decrypt-failed'));
    await assert.rejects(unsealContact(flip(sealed, 'ct', Buffer.from(sealed.ct, 'base64').length - 1), nonce), isCode('decrypt-failed'));
    await assert.rejects(unsealContact(flip(sealed, 'iv'), nonce), isCode('decrypt-failed'));
    // A different salt or check means no nonce in range matches.
    await assert.rejects(solve(flip(sealed, 'salt'), { workers: 0 }), isCode('not-found'));
    await assert.rejects(solve({ ...sealed, check: '0'.repeat(64) }, { workers: 0 }), isCode('not-found'));
  });

  it('rejects malformed cards', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 8 });
    const bad: unknown[] = [
      null,
      'nope',
      [],
      { ...sealed, v: 2 },
      { ...sealed, alg: 'AES-128-GCM' },
      { ...sealed, salt: Buffer.alloc(15).toString('base64') },
      { ...sealed, salt: 'not base64!' },
      { ...sealed, iv: Buffer.alloc(16).toString('base64') },
      { ...sealed, check: sealed.check.toUpperCase() },
      { ...sealed, check: sealed.check.slice(2) },
      { ...sealed, ct: Buffer.alloc(16).toString('base64') },
      { ...sealed, createdAt: 'yesterday' },
      { ...sealed, ct: undefined },
    ];
    for (const input of bad) {
      assert.throws(() => parseSealed(input), isCode('invalid-sealed'), JSON.stringify(input));
      await assert.rejects(solve(input, { workers: 0 }), isCode('invalid-sealed'));
    }
    assert.deepEqual(parseSealed({ ...sealed, extra: true }), sealed);
  });
});

describe('contact validation', () => {
  it('normalises every field and is idempotent', () => {
    const input = {
      email: ' first.last+tag@Sub.Example.ORG ',
      phone: '+1 (415) 555-0100',
      telegram: 'https://t.me/Some_Handle',
      whatsapp: 'https://wa.me/6591234567',
      signal: '@some_one.42',
      calendar: 'https://cal.example.com/x?y=1',
      note: '  Line one\nLine two  ',
    };
    const out = parseContact(input);
    assert.deepEqual(out, {
      email: 'first.last+tag@sub.example.org',
      phone: '+14155550100',
      telegram: 'Some_Handle',
      whatsapp: '+6591234567',
      signal: 'some_one.42',
      calendar: 'https://cal.example.com/x?y=1',
      note: 'Line one\nLine two',
    });
    assert.deepEqual(parseContact(out), out);
    assert.deepEqual(verify(out), out);
    assert.equal(parseContact({ email: 'a@b.co', signal: '+44 20 7946 0958' }).signal, '+442079460958');
    assert.equal(parseContact({ email: 'a@b.co', signal: 'https://signal.me/#eu/abc' }).signal, 'https://signal.me/#eu/abc');
    assert.deepEqual(parseContact({ email: 'a@b.co', phone: '', note: '   ', telegram: null }), { email: 'a@b.co' });
  });

  it('lists every problem at once', () => {
    const cases: [unknown, string[]][] = [
      [{}, ['email']],
      [{ email: 'not-an-email' }, ['email']],
      [{ email: 'a@b' }, ['email']],
      [{ email: 'a@b.co', phone: '91234567' }, ['phone']],
      [{ email: 'a@b.co', telegram: 'abc' }, ['telegram']],
      [{ email: 'a@b.co', whatsapp: 'wa.me/12' }, ['whatsapp']],
      [{ email: 'a@b.co', signal: 'https://evil.example/#signal.me' }, ['signal']],
      [{ email: 'a@b.co', calendar: 'http://cal.example.com' }, ['calendar']],
      [{ email: 'a@b.co', calendar: 'https://user:pw@cal.example.com' }, ['calendar']],
      [{ email: 'a@b.co', note: 'x'.repeat(281) }, ['note']],
      [{ email: 'a@b.co', note: 'bell\u0007' }, ['note']],
      [{ email: 42, phone: 5 }, ['email', 'phone']],
      [{ email: 'a@b.co', emial: 'typo@b.co' }, ['emial']],
    ];
    for (const [input, fields] of cases) {
      assert.throws(
        () => parseContact(input),
        (error: unknown) =>
          isCode('invalid-contact')(error) &&
          (error as ContactError).issues.length === fields.length &&
          fields.every((f, i) => (error as ContactError).issues[i].startsWith(`${f}:`)),
        JSON.stringify(input),
      );
    }
    assert.throws(() => parseContact(['a@b.co']), isCode('invalid-contact'));
    assert.equal(parseContact({ email: 'a@b.co', note: 'é'.repeat(280) }).note?.length, 280);
  });

  it('refuses to seal invalid details', async () => {
    await assert.rejects(sealContact({ email: 'nope' }, { difficulty: 8 }), isCode('invalid-contact'));
  });
});

describe('solve()', () => {
  it('reports progress and honours AbortSignal', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 28, nonce: 2 ** 28 - 1 });
    const controller = new AbortController();
    const seen: SolveProgress[] = [];
    await assert.rejects(
      solve(sealed, {
        workers: 0,
        signal: controller.signal,
        onProgress: (progress) => {
          seen.push(progress);
          if (seen.length === 3) controller.abort();
        },
      }),
      { name: 'AbortError' },
    );
    assert.equal(seen.length, 3);
    for (const p of seen) {
      assert.equal(p.total, 2 ** 28);
      assert.equal(p.workers, 0);
      assert.ok(p.hashes > 0 && p.fraction === p.hashes / p.total && p.hashRate > 0 && p.elapsedMs > 0);
    }
    assert.ok(seen[0].hashes < seen[1].hashes && seen[1].hashes < seen[2].hashes);
  });

  it('rejects at once when already aborted, and passes a custom reason through', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 8 });
    await assert.rejects(solve(sealed, { signal: AbortSignal.abort() }), { name: 'AbortError' });
    const reason = new Error('navigated away');
    await assert.rejects(solve(sealed, { signal: AbortSignal.abort(reason) }), (e) => e === reason);
  });

  it('keeps solving when onProgress throws', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 18, nonce: 2 ** 18 - 1 });
    const reported: unknown[] = [];
    const g = globalThis as { reportError?: (error: unknown) => void };
    const original = g.reportError;
    g.reportError = (error) => reported.push(error);
    try {
      const result = await solve(sealed, {
        workers: 0,
        onProgress: () => {
          throw new Error('ui bug');
        },
      });
      assert.deepEqual(result.contact, NORMALISED);
    } finally {
      g.reportError = original;
    }
    assert.ok(reported.length > 0);
  });

  it('rejects with "unsupported" before searching when WebCrypto is missing', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 8 });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      await assert.rejects(solve(sealed, { workers: 0 }), isCode('unsupported'));
    } finally {
      Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Worker path. `ShimWorker` runs the real pow.worker.ts in a worker thread behind the subset of
// the Web Worker API that solver.ts uses.
// ---------------------------------------------------------------------------------------------

const BOOT = `
const { parentPort, workerData } = require('node:worker_threads');
globalThis.self = globalThis;
globalThis.postMessage = (message) => parentPort.postMessage(message);
// Browsers queue MessageChannel and incoming worker messages FIFO on one task source. Node drains
// up to 1000 messages per port per turn, which would starve 'cancel' behind the worker's own
// ticks, so emulate the browser ordering.
globalThis.MessageChannel = class {
  constructor() {
    const port1 = { onmessage: null, closed: false, close() { this.closed = true; } };
    this.port1 = port1;
    this.port2 = { postMessage: (data) => setImmediate(() => port1.closed || port1.onmessage?.({ data })) };
  }
};
import(workerData.url).then(() => parentPort.on('message', (data) => globalThis.onmessage?.({ data })));
`;

class ShimWorker {
  static created: ShimWorker[] = [];
  onmessage: ((event: { data: PowResponse }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  #thread: ThreadWorker;

  constructor(url: URL | string, options?: { type?: string }) {
    assert.equal(options?.type, 'module');
    this.#thread = new ThreadWorker(BOOT, { eval: true, workerData: { url: String(url) } });
    this.#thread.on('message', (data: PowResponse) => this.onmessage?.({ data }));
    this.#thread.on('error', (error: Error) => this.onerror?.({ message: error.message, preventDefault() {} }));
    ShimWorker.created.push(this);
  }

  postMessage(data: unknown): void {
    if (!this.terminated) this.#thread.postMessage(data);
  }

  terminate(): void {
    this.terminated = true;
    void this.#thread.terminate();
  }
}

/** Runs `fn` with globalThis.Worker replaced, then checks every worker it created was terminated. */
async function withWorker<T>(Impl: unknown, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { Worker?: unknown };
  const previous = g.Worker;
  ShimWorker.created = [];
  g.Worker = Impl;
  try {
    return await fn();
  } finally {
    g.Worker = previous;
    assert.ok(ShimWorker.created.every((w) => w.terminated), 'all workers terminated');
  }
}

/** Collects worker messages until `stop` returns true. */
function collect(worker: ShimWorker, stop: (m: PowResponse) => boolean): Promise<PowResponse[]> {
  const messages: PowResponse[] = [];
  return new Promise((resolve) => {
    worker.onmessage = ({ data }) => {
      messages.push(data);
      if (stop(data)) resolve(messages);
    };
  });
}

describe('solve() with workers', () => {
  it('finds the nonce across workers, aggregates progress and terminates them', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 21, nonce: 2 ** 21 - 3 });
    const seen: SolveProgress[] = [];
    const result = await withWorker(ShimWorker, () => solve(sealed, { workers: 4, onProgress: (p) => seen.push(p) }));
    assert.deepEqual(result.contact, NORMALISED);
    assert.equal(result.nonce, 2 ** 21 - 3);
    assert.equal(ShimWorker.created.length, 4);
    assert.ok(seen.length > 0 && seen.every((p) => p.workers === 4 && p.total === 2 ** 21));
    // Blocks are handed out in order, so the last nonce is only reached after ~all the space.
    assert.ok(result.hashes > 2 ** 20, `hashes ${result.hashes}`);
  });

  it('uses fewer workers than blocks on tiny puzzles', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 6 });
    const result = await withWorker(ShimWorker, () => solve(sealed, { workers: 8 }));
    assert.deepEqual(result.contact, NORMALISED);
    assert.equal(ShimWorker.created.length, 1);
  });

  it('reports not-found after every block comes back empty', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 17 });
    await assert.rejects(
      withWorker(ShimWorker, () => solve({ ...sealed, check: 'f'.repeat(64) }, { workers: 3 })),
      isCode('not-found'),
    );
  });

  it('terminates workers on abort', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 30, nonce: 2 ** 30 - 1 });
    const controller = new AbortController();
    await assert.rejects(
      withWorker(ShimWorker, () =>
        solve(sealed, { workers: 2, signal: controller.signal, onProgress: () => controller.abort() }),
      ),
      { name: 'AbortError' },
    );
  });

  it('falls back to the main thread when workers cannot start or crash', async () => {
    const sealed = await sealContact(CONTACT, { difficulty: 14 });
    class Blocked {
      constructor() {
        throw new DOMException('blocked by CSP', 'SecurityError');
      }
    }
    const blocked = await withWorker(Blocked, () => solve(sealed, { workers: 4 }));
    assert.deepEqual(blocked.contact, NORMALISED);

    class Broken extends ShimWorker {
      override postMessage(): void {
        queueMicrotask(() => this.onerror?.({ message: 'boom', preventDefault() {} }));
      }
    }
    const workers: number[] = [];
    const broken = await withWorker(Broken, () => solve(sealed, { workers: 2, onProgress: (p) => workers.push(p.workers) }));
    assert.deepEqual(broken.contact, NORMALISED);
    assert.ok(workers.every((n) => n === 0));
  });
});

describe('pow.worker protocol', () => {
  const workerUrl = new URL('../src/scripts/contact/pow.worker.ts', import.meta.url);
  const setup = () => {
    const salt = randomBytes(16);
    const nonce = 3_000_123;
    return { salt, nonce, check: sha256(message(salt, 1, nonce)), worker: new ShimWorker(workerUrl, { type: 'module' }) };
  };

  it('scans queued ranges in order and reports done/found with cumulative hashes', async () => {
    const { salt, check, nonce, worker } = setup();
    try {
      const messages = collect(worker, (m) => m.type === 'found' || m.type === 'error');
      worker.postMessage({ type: 'init', salt, check });
      worker.postMessage({ type: 'scan', start: 0, end: 100_000 });
      worker.postMessage({ type: 'scan', start: nonce - 10, end: nonce + 10 });
      const got = await messages;
      const done = got.filter((m) => m.type === 'done');
      assert.deepEqual(done, [{ type: 'done', start: 0, end: 100_000, hashes: 100_000 }]);
      assert.deepEqual(got.at(-1), { type: 'found', nonce, hashes: 100_000 + 11 });
    } finally {
      worker.terminate();
    }
  });

  it('stops on cancel', async () => {
    const { salt, check, worker } = setup();
    try {
      const firstProgress = collect(worker, (m) => m.type === 'progress');
      worker.postMessage({ type: 'init', salt, check });
      worker.postMessage({ type: 'scan', start: 0, end: 2 ** 32 });
      await firstProgress;
      worker.postMessage({ type: 'cancel' });
      await new Promise((r) => setTimeout(r, 150)); // let in-flight messages drain
      const after: PowResponse[] = [];
      worker.onmessage = ({ data }) => after.push(data);
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(after, []);
    } finally {
      worker.terminate();
    }
  });

  it('rejects bad requests', async () => {
    const { salt, check, worker } = setup();
    try {
      const early = collect(worker, (m) => m.type === 'error');
      worker.postMessage({ type: 'scan', start: 0, end: 10 });
      assert.match((await early).at(-1)!.type, /error/);
    } finally {
      worker.terminate();
    }
    const second = setup();
    try {
      const bad = collect(second.worker, (m) => m.type === 'error');
      second.worker.postMessage({ type: 'init', salt, check });
      second.worker.postMessage({ type: 'scan', start: 5, end: 2 ** 32 + 1 });
      assert.deepEqual((await bad).at(-1), { type: 'error', message: 'invalid range [5, 4294967297)' });
    } finally {
      second.worker.terminate();
    }
  });
});
