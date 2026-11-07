/**
 * Contact-card solver: finds the proof-of-work nonce for a sealed card and decrypts it.
 * UI-agnostic. Typical wiring:
 *
 *   import sealedJson from '../../data/contact.sealed.json';
 *   import { parseSealed } from '../../lib/contact/card.ts';
 *   import { readCachedContact, writeCachedContact } from './cache.ts';
 *
 *   const sealed = parseSealed(sealedJson);
 *   const { solve } = await import('./solver.ts'); // the kernel and the cipher load on first use
 *   const contact = readCachedContact(sealed) ?? (await solve(sealed, { onProgress, signal })).contact;
 *   writeCachedContact(sealed, contact);
 *
 * The search space is split into contiguous blocks that are handed out on demand, each worker
 * keeping two queued. Fast cores therefore take more blocks than slow ones. On big.LITTLE phones,
 * fixed per-worker chunks would leave the little cores' chunks as the long pole.
 */
import {
  ContactError,
  createPowSearch,
  decodeSealed,
  parseContact,
  parseSealed,
  requireWebCrypto,
  unsealContact,
  type Contact,
} from '../../lib/contact/seal.ts';
import type { PowRequest, PowResponse } from './pow.worker.ts';

// The tab-session cache lives in its own module, so a page can read it without loading the solver.
export { clearCachedContact, readCachedContact, writeCachedContact } from './cache.ts';

export interface SolveProgress {
  /** Nonces tested so far. Approximate while workers run, since each reports every ~50 ms. */
  hashes: number;
  /** Size of the search space, 2^difficulty. */
  total: number;
  /** hashes / total, 0–1. The nonce is uniformly random, so on average it turns up at 0.5. */
  fraction: number;
  /** Average hashes per second since solve() started. */
  hashRate: number;
  elapsedMs: number;
  /** Worker threads in use. 0 means the main-thread fallback. */
  workers: number;
}

export interface SolveOptions {
  /** Called at most every ~50 ms. If it throws, the error is reported and solving continues. */
  onProgress?: (progress: SolveProgress) => void;
  /** Aborting terminates the workers and rejects with `signal.reason` (an AbortError by default). */
  signal?: AbortSignal;
  /** Worker threads. Defaults to min(hardwareConcurrency || 4, 8). 0 forces the main thread. */
  workers?: number;
}

export interface SolveResult {
  contact: Contact;
  nonce: number;
  /** Nonces tested (approximate with workers). */
  hashes: number;
  /** Wall time from the call to the decrypted card. */
  ms: number;
}

const PROGRESS_MS = 50;
/** Nonces per dispatched block: ~12 ms on a desktop core (2.7 MH/s), ~150 ms on a phone's little core. */
const BLOCK = 1 << 15;
/** Main-thread fallback: work per slice before yielding, so that frames still render. */
const MAIN_THREAD_SLICE_MS = 12;

interface Search {
  salt: Uint8Array;
  check: Uint8Array;
  total: number;
  /** Receives the running hash count; throttles and forwards it to onProgress. */
  report: (hashes: number, workers: number) => void;
  signal?: AbortSignal;
}

/** Workers could not be used (blocked by CSP, unsupported, failed to load or crashed). */
class WorkerFailure extends Error {}

const reportError = (error: unknown): void => {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
};

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/**
 * Finds the nonce and decrypts the card. Rejects with ContactError ('invalid-sealed',
 * 'unsupported', 'not-found', 'decrypt-failed', 'invalid-contact') or with the abort reason.
 */
export async function solve(sealedInput: unknown, options: SolveOptions = {}): Promise<SolveResult> {
  const { onProgress, signal } = options;
  const started = performance.now();
  const sealed = parseSealed(sealedInput);
  requireWebCrypto(); // fail before burning CPU on a page that could not decrypt anyway
  if (signal?.aborted) throw abortReason(signal);

  const { salt, check } = decodeSealed(sealed);
  const total = 2 ** sealed.difficulty;
  let lastReport = -Infinity;
  const search: Search = {
    salt,
    check,
    total,
    signal,
    report: (hashes, workers) => {
      const now = performance.now();
      if (!onProgress || now - lastReport < PROGRESS_MS) return;
      lastReport = now;
      const elapsedMs = now - started;
      const progress = {
        hashes,
        total,
        fraction: Math.min(1, hashes / total),
        hashRate: elapsedMs > 0 ? (hashes * 1000) / elapsedMs : 0,
        elapsedMs,
        workers,
      };
      try {
        onProgress(progress);
      } catch (error) {
        reportError(error);
      }
    },
  };

  const threads = Math.max(0, Math.floor(options.workers ?? defaultWorkerCount()));
  let found: { nonce: number; hashes: number };
  if (threads > 0 && typeof Worker === 'function') {
    try {
      found = await searchWithWorkers(search, threads);
    } catch (error) {
      if (!(error instanceof WorkerFailure)) throw error;
      // Slower, but it still works.
      found = await searchOnMainThread(search);
    }
  } else {
    found = await searchOnMainThread(search);
  }

  const contact = await unsealContact(sealed, found.nonce);
  if (signal?.aborted) throw abortReason(signal);
  return { contact, nonce: found.nonce, hashes: found.hashes, ms: performance.now() - started };
}

/** Throws ContactError('invalid-contact') unless `value` is a well-formed card; returns it normalised. */
export function verify(value: unknown): Contact {
  return parseContact(value);
}

function defaultWorkerCount(): number {
  const cores = typeof navigator === 'undefined' ? 0 : navigator.hardwareConcurrency;
  return Math.min(cores || 4, 8);
}

const notFound = () =>
  new ContactError('not-found', 'Searched every nonce without a match. The sealed card is corrupt or was tampered with.');

function searchWithWorkers(search: Search, threads: number): Promise<{ nonce: number; hashes: number }> {
  const { salt, check, total, signal } = search;
  const count = Math.max(1, Math.min(threads, Math.ceil(total / BLOCK)));
  const block = Math.min(BLOCK, Math.ceil(total / count));

  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const counts = new Array<number>(count).fill(0);
    let nextStart = 0;
    let pending = 0; // blocks dispatched and not yet reported done
    let settled = false;

    const sum = () => counts.reduce((a, b) => a + b, 0);
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      for (const worker of workers) {
        worker.postMessage({ type: 'cancel' } satisfies PowRequest);
        worker.terminate();
      }
      settle();
    };
    const onAbort = () => finish(() => reject(abortReason(signal!)));
    const workerFailed = (detail: unknown) =>
      finish(() => reject(new WorkerFailure(`Contact worker failed: ${String(detail)}`)));
    const dispatch = (worker: Worker): void => {
      if (nextStart >= total) return;
      const start = nextStart;
      nextStart = Math.min(total, start + block);
      pending++;
      worker.postMessage({ type: 'scan', start, end: nextStart } satisfies PowRequest);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    for (let i = 0; i < count && !settled; i++) {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module', name: 'contact-pow' });
      } catch (error) {
        workerFailed(error);
        return;
      }
      workers.push(worker);
      worker.onmessage = (event: MessageEvent<PowResponse>) => {
        if (settled) return;
        const message = event.data;
        if (message.type === 'error') return workerFailed(message.message);
        counts[i] = message.hashes;
        if (message.type === 'found') {
          const { nonce } = message;
          return finish(() => resolve({ nonce, hashes: sum() }));
        }
        if (message.type === 'done') {
          pending--;
          dispatch(worker);
          if (pending === 0) return finish(() => reject(notFound()));
        }
        search.report(sum(), count);
      };
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        workerFailed(event.message || 'could not load the worker script');
      };
      worker.onmessageerror = () => workerFailed('message could not be deserialised');
      worker.postMessage({ type: 'init', salt, check } satisfies PowRequest);
      dispatch(worker);
      dispatch(worker); // two in flight, so a worker never idles waiting for the main thread
    }
  });
}

const yieldToEventLoop = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
};

async function searchOnMainThread(search: Search): Promise<{ nonce: number; hashes: number }> {
  const { total, signal } = search;
  const kernel = createPowSearch(search.salt, search.check);
  let next = 0;
  while (next < total) {
    const deadline = performance.now() + MAIN_THREAD_SLICE_MS;
    do {
      const to = Math.min(next + 2048, total);
      const nonce = kernel.scan(next, to);
      if (nonce >= 0) return { nonce, hashes: nonce + 1 };
      next = to;
    } while (next < total && performance.now() < deadline);
    search.report(next, 0);
    await yieldToEventLoop();
    if (signal?.aborted) throw abortReason(signal);
  }
  throw notFound();
}
