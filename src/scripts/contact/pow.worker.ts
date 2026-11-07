/**
 * Proof-of-work worker for the contact card. solver.ts spawns it as a module worker:
 *   new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' })
 *
 * Protocol, in message order:
 *   → init      { salt, check }          sent once, before any scan
 *   → scan      { start, end }           queues the nonce range [start, end); queued ranges run in order
 *   → cancel                             stops for good (the solver also terminates the worker)
 *   ← progress  { hashes }               about every 50 ms while busy
 *   ← done      { start, end, hashes }   a queued range was exhausted without a match
 *   ← found     { nonce, hashes }        match found; the worker stops
 *   ← error     { message }
 * `hashes` is always this worker's cumulative count since init.
 */
import { createPowSearch, type PowSearch } from '../../lib/contact/seal.ts';

export type PowRequest =
  | { type: 'init'; salt: Uint8Array; check: Uint8Array }
  | { type: 'scan'; start: number; end: number }
  | { type: 'cancel' };

export type PowResponse =
  | { type: 'progress'; hashes: number }
  | { type: 'done'; start: number; end: number; hashes: number }
  | { type: 'found'; nonce: number; hashes: number }
  | { type: 'error'; message: string };

/** The parts of DedicatedWorkerGlobalScope used here. The project compiles against the DOM lib. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<PowRequest>) => void) | null;
  postMessage(message: PowResponse): void;
}

const scope = self as unknown as WorkerScope;
const PROGRESS_MS = 50;
/** Nonces per kernel call between clock checks: ~1 ms on a desktop core, a few ms on a phone. */
const SLICE = 4096;

let search: PowSearch | null = null;
const queue: { start: number; end: number }[] = [];
let range: { start: number; end: number; next: number } | null = null;
let hashes = 0;
let running = false;
let stopped = false;

// A MessageChannel ping yields to the event loop without setTimeout's 4 ms clamp. That lets queued
// 'scan' and 'cancel' messages in between slices.
const ticker = new MessageChannel();
ticker.port1.onmessage = tick;

const isNonceBound = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 2 ** 32;

function fail(error: unknown): void {
  stopped = true;
  scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}

function tick(): void {
  if (stopped || !search) {
    running = false;
    return;
  }
  try {
    const deadline = performance.now() + PROGRESS_MS;
    for (;;) {
      if (!range) {
        const next = queue.shift();
        if (!next) break; // queue drained: report, then idle until the next 'scan'
        range = { ...next, next: next.start };
      }
      const from = range.next;
      const to = Math.min(from + SLICE, range.end);
      const nonce = search.scan(from, to);
      if (nonce >= 0) {
        hashes += nonce - from + 1;
        stopped = true;
        running = false;
        scope.postMessage({ type: 'found', nonce, hashes });
        return;
      }
      hashes += to - from;
      range.next = to;
      if (to === range.end) {
        scope.postMessage({ type: 'done', start: range.start, end: range.end, hashes });
        range = null;
      }
      if (performance.now() >= deadline) {
        scope.postMessage({ type: 'progress', hashes });
        ticker.port2.postMessage(null);
        return;
      }
    }
    scope.postMessage({ type: 'progress', hashes });
    running = false;
  } catch (error) {
    running = false;
    fail(error);
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  if (stopped) return;
  switch (message.type) {
    case 'init':
      try {
        search = createPowSearch(message.salt, message.check);
      } catch (error) {
        fail(error);
      }
      break;
    case 'scan':
      if (!search) return fail(new Error('scan before init'));
      if (!isNonceBound(message.start) || !isNonceBound(message.end) || message.start >= message.end) {
        return fail(new RangeError(`invalid range [${message.start}, ${message.end})`));
      }
      queue.push({ start: message.start, end: message.end });
      if (!running) {
        running = true;
        tick();
      }
      break;
    case 'cancel':
      stopped = true;
      queue.length = 0;
      range = null;
      ticker.port1.close();
      break;
  }
};
