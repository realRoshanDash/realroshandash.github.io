/**
 * Sealed contact card: the shared format, validation, crypto and proof-of-work kernel.
 * Runs unchanged in the browser, in workers and in Node ≥ 24 (WebCrypto + type stripping);
 * no dependencies.
 *
 * `npm run seal-contact` encrypts the contact details at build time. To read them, a browser has
 * to find the secret nonce n ∈ [0, 2^difficulty) such that
 *
 *   SHA-256(salt ‖ 0x01 ‖ u32be(n)) = check
 *
 * and then derive key = SHA-256(salt ‖ 0x02 ‖ u32be(n)) to AES-256-GCM-decrypt `ct`. n itself is
 * never stored. Harvesters that only parse HTML see ciphertext, and a bot has to spend the same
 * CPU-seconds as a visitor. This is a speed bump against bulk scraping. It does not keep a secret
 * from anyone willing to run the search.
 */

export const SEALED_VERSION = 1;
export const SEALED_ALG = 'AES-256-GCM';
/** Bits of proof-of-work. The expected work is 2^(d-1) hashes and the worst case is 2^d. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 32;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const DIGEST_BYTES = 32;
const TAG_BYTES = 16;
/** Domain-separation bytes: the public check and the secret key never hash the same message. */
const DOMAIN_CHECK = 0x01;
const DOMAIN_KEY = 0x02;

/** The committed `src/data/contact.sealed.json`. */
export interface SealedContact {
  v: typeof SEALED_VERSION;
  alg: typeof SEALED_ALG;
  difficulty: number;
  /** base64, 16 bytes. */
  salt: string;
  /** hex SHA-256(salt ‖ 0x01 ‖ u32be(n)). */
  check: string;
  /** base64, 12 bytes. */
  iv: string;
  /** base64 AES-GCM ciphertext ‖ 16-byte tag. */
  ct: string;
  /** ISO 8601. */
  createdAt: string;
}

export const CONTACT_FIELDS = ['email', 'phone', 'telegram', 'whatsapp', 'signal', 'calendar', 'note'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/** The decrypted card, always in normalised form (see parseContact). Render every value as text. */
export interface Contact {
  email: string;
  /** E.164, e.g. "+6591234567". */
  phone?: string;
  /** Username without "@" (link: https://t.me/<telegram>). */
  telegram?: string;
  /** E.164 (link: https://wa.me/<digits without +>). */
  whatsapp?: string;
  /** Username "name.42", an E.164 number, or an https://signal.me/ link. */
  signal?: string;
  /** https:// booking link. */
  calendar?: string;
  /** Short plain-text note, ≤ 280 characters. */
  note?: string;
}

export type ContactErrorCode =
  | 'invalid-contact' // contact details failed validation (CLI input or decrypted payload)
  | 'invalid-sealed' // sealed JSON is malformed or an unsupported version
  | 'not-found' // the whole search space was scanned without a match (tampered salt/check)
  | 'decrypt-failed' // AES-GCM authentication failed (wrong nonce or tampered iv/ct)
  | 'unsupported'; // no WebCrypto: the page is not a secure context (HTTPS or localhost)

export class ContactError extends Error {
  readonly code: ContactErrorCode;
  /** Per-field problems for 'invalid-contact' / 'invalid-sealed'. */
  readonly issues: readonly string[];

  constructor(code: ContactErrorCode, message: string, options?: { cause?: unknown; issues?: string[] }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ContactError';
    this.code = code;
    this.issues = options?.issues ?? [];
  }
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const TELEGRAM_RE = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/;
const SIGNAL_USERNAME_RE = /^[A-Za-z_][A-Za-z0-9_]{2,31}\.\d{2,10}$/;
// Allows newline and tab only.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const NOTE_MAX = 280;

const toE164 = (value: string): string | null => {
  const compact = value.replace(/[\s().-]/g, '');
  return E164_RE.test(compact) ? compact : null;
};

const httpsUrl = (value: string, host?: string): string | null => {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (host && url.hostname !== host) return null;
    return url.href;
  } catch {
    return null;
  }
};

/** Each normaliser returns the canonical value, or null if invalid. All are idempotent. */
const NORMALISE: Record<ContactField, (value: string) => string | null> = {
  email: (v) => {
    const at = v.lastIndexOf('@');
    if (v.length > 254 || at < 1 || at > 64 || !EMAIL_RE.test(v)) return null;
    return v.slice(0, at) + v.slice(at).toLowerCase();
  },
  phone: toE164,
  telegram: (v) => {
    const handle = v.replace(/^(?:https?:\/\/)?(?:t|telegram)\.me\/|^@/i, '').replace(/\/$/, '');
    return TELEGRAM_RE.test(handle) ? handle : null;
  },
  whatsapp: (v) => {
    const link = /^(?:https?:\/\/)?wa\.me\/\+?(\d+)\/?$/i.exec(v);
    return toE164(link ? `+${link[1]}` : v);
  },
  signal: (v) => {
    if (/^https:\/\//i.test(v)) return httpsUrl(v, 'signal.me');
    const username = v.replace(/^@/, '');
    return SIGNAL_USERNAME_RE.test(username) ? username : toE164(v);
  },
  calendar: (v) => httpsUrl(v),
  note: (v) => ([...v].length <= NOTE_MAX && !CONTROL_RE.test(v) ? v : null),
};

const HINT: Record<ContactField, string> = {
  email: 'expected an address like name@example.com',
  phone: 'expected an international number like +65 9123 4567',
  telegram: 'expected a username (5–32 letters, digits or _), @username or a t.me link',
  whatsapp: 'expected an international number like +65 9123 4567 or a wa.me link',
  signal: 'expected a username like name.42, an international number or an https://signal.me link',
  calendar: 'expected an https:// URL',
  note: `expected plain text of at most ${NOTE_MAX} characters`,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates contact details and returns them normalised (trimmed, canonical E.164 numbers,
 * handles without "@", lowercase email domain). Empty optional fields are dropped. Throws a
 * ContactError('invalid-contact') that lists every problem. Idempotent, so the same function
 * checks both the CLI input and the decrypted card.
 */
export function parseContact(input: unknown): Contact {
  if (!isRecord(input)) {
    throw new ContactError('invalid-contact', 'Contact details must be a JSON object.', {
      issues: ['expected an object'],
    });
  }
  const issues: string[] = [];
  const out: Partial<Record<ContactField, string>> = {};
  for (const key of Object.keys(input)) {
    if (!(CONTACT_FIELDS as readonly string[]).includes(key)) issues.push(`${key}: unknown field`);
  }
  for (const field of CONTACT_FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      if (field === 'email') issues.push('email: required');
      continue;
    }
    if (typeof raw !== 'string') {
      issues.push(`${field}: must be a string`);
      continue;
    }
    const value = NORMALISE[field](raw.trim());
    if (value === null) issues.push(`${field}: ${HINT[field]}`);
    else out[field] = value;
  }
  if (issues.length > 0) {
    throw new ContactError('invalid-contact', `Invalid contact details: ${issues.join('; ')}.`, { issues });
  }
  return out as Contact;
}

const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEX_RE = /^[0-9a-f]*$/;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  if (!B64_RE.test(text)) return null;
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 2 !== 0 || !HEX_RE.test(text)) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(2 * i, 2 * i + 2), 16);
  return bytes;
}

const isDifficulty = (d: unknown): d is number =>
  Number.isInteger(d) && (d as number) >= MIN_DIFFICULTY && (d as number) <= MAX_DIFFICULTY;

/** The raw bytes of a parsed card. */
export interface SealedBytes {
  salt: Uint8Array<ArrayBuffer>;
  check: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

/** Validates `contact.sealed.json` (as parsed JSON) and returns a clean copy. Unknown keys are dropped. */
export function parseSealed(input: unknown): SealedContact {
  const issues: string[] = [];
  const invalid = () =>
    new ContactError('invalid-sealed', `Invalid sealed contact card: ${issues.join('; ')}.`, { issues });
  if (!isRecord(input)) {
    issues.push('expected an object');
    throw invalid();
  }
  if (input.v !== SEALED_VERSION) issues.push(`v: unsupported version ${JSON.stringify(input.v)}`);
  if (input.alg !== SEALED_ALG) issues.push(`alg: expected ${SEALED_ALG}`);
  if (!isDifficulty(input.difficulty)) issues.push(`difficulty: expected an integer ${MIN_DIFFICULTY}–${MAX_DIFFICULTY}`);
  const bytes = (key: string, decode: (s: string) => Uint8Array | null, ok: (n: number) => boolean) => {
    const value = input[key];
    const decoded = typeof value === 'string' ? decode(value) : null;
    if (!decoded || !ok(decoded.length)) issues.push(`${key}: malformed`);
  };
  bytes('salt', fromBase64, (n) => n === SALT_BYTES);
  bytes('check', fromHex, (n) => n === DIGEST_BYTES);
  bytes('iv', fromBase64, (n) => n === IV_BYTES);
  bytes('ct', fromBase64, (n) => n > TAG_BYTES);
  if (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) issues.push('createdAt: malformed');
  if (issues.length > 0) throw invalid();
  const { v, alg, difficulty, salt, check, iv, ct, createdAt } = input as unknown as SealedContact;
  return { v, alg, difficulty, salt, check, iv, ct, createdAt };
}

/** Decodes the binary fields of a card that already passed parseSealed. */
export function decodeSealed(sealed: SealedContact): SealedBytes {
  const salt = fromBase64(sealed.salt);
  const check = fromHex(sealed.check);
  const iv = fromBase64(sealed.iv);
  const ct = fromBase64(sealed.ct);
  if (!salt || !check || !iv || !ct) throw new ContactError('invalid-sealed', 'Invalid sealed contact card.');
  return { salt, check, iv, ct };
}

// ---------------------------------------------------------------------------------------------
// Sealing and unsealing (WebCrypto)
// ---------------------------------------------------------------------------------------------

/** WebCrypto, or a ContactError('unsupported'). `crypto.subtle` only exists in secure contexts. */
export function requireWebCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ContactError('unsupported', 'WebCrypto is unavailable. The page must be served over HTTPS (or localhost).');
  }
  return subtle;
}

/** salt ‖ domain ‖ u32be(nonce), the 21-byte message behind both the check and the key. */
function powMessage(salt: Uint8Array, domain: number, nonce: number): Uint8Array<ArrayBuffer> {
  const message = new Uint8Array(SALT_BYTES + 5);
  message.set(salt);
  message[SALT_BYTES] = domain;
  new DataView(message.buffer).setUint32(SALT_BYTES + 1, nonce);
  return message;
}

async function deriveKey(salt: Uint8Array, nonce: number, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const subtle = requireWebCrypto();
  const raw = await subtle.digest('SHA-256', powMessage(salt, DOMAIN_KEY, nonce));
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}

const isNonce = (n: unknown, difficulty: number): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < 2 ** difficulty;

export interface SealOptions {
  difficulty: number;
  /** Tests only. Production seals must leave this unset so that n is uniformly random. */
  nonce?: number;
  /** Timestamp for createdAt (default: now). */
  now?: Date;
}

/**
 * Validates and encrypts contact details. Before returning, it proves that the PoW kernel finds n
 * and that the card opens again. After that, n only exists inside this call.
 */
export async function sealContact(input: unknown, options: SealOptions): Promise<SealedContact> {
  const contact = parseContact(input);
  const { difficulty } = options;
  if (!isDifficulty(difficulty)) {
    throw new RangeError(`difficulty must be an integer ${MIN_DIFFICULTY}–${MAX_DIFFICULTY}, got ${difficulty}`);
  }
  // The top `difficulty` bits of a uniform u32 are uniform on [0, 2^difficulty).
  const nonce = options.nonce ?? crypto.getRandomValues(new Uint32Array(1))[0] >>> (32 - difficulty);
  if (!isNonce(nonce, difficulty)) throw new RangeError(`nonce must be an integer in [0, 2^${difficulty})`);

  const subtle = requireWebCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const check = new Uint8Array(await subtle.digest('SHA-256', powMessage(salt, DOMAIN_CHECK, nonce)));
  const key = await deriveKey(salt, nonce, 'encrypt');
  const plaintext = new TextEncoder().encode(JSON.stringify(contact));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));

  const sealed: SealedContact = {
    v: SEALED_VERSION,
    alg: SEALED_ALG,
    difficulty,
    salt: toBase64(salt),
    check: toHex(check),
    iv: toBase64(iv),
    ct: toBase64(ct),
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  // Self-check: the hand-written kernel must agree with WebCrypto, or no browser could ever open it.
  if (createPowSearch(salt, check).scan(nonce, nonce + 1) !== nonce) {
    throw new Error('PoW kernel disagrees with WebCrypto SHA-256; refusing to write an unsolvable card');
  }
  if (JSON.stringify(await unsealContact(sealed, nonce)) !== JSON.stringify(contact)) {
    throw new Error('Sealed card did not round-trip');
  }
  return sealed;
}

/**
 * Decrypts a card with a known nonce. Rejects with ContactError 'decrypt-failed' (wrong nonce or
 * tampered data), 'invalid-contact' (bad payload) or 'unsupported' (no WebCrypto).
 */
export async function unsealContact(sealed: SealedContact, nonce: number): Promise<Contact> {
  const { salt, iv, ct } = decodeSealed(sealed);
  const key = await deriveKey(salt, nonce, 'decrypt');
  let plaintext: ArrayBuffer;
  try {
    plaintext = await requireWebCrypto().decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch (cause) {
    throw new ContactError('decrypt-failed', 'The contact card could not be decrypted (wrong nonce or tampered data).', {
      cause,
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch (cause) {
    throw new ContactError('invalid-contact', 'The decrypted contact card is not valid JSON.', { cause });
  }
  return parseContact(payload);
}

// ---------------------------------------------------------------------------------------------
// Proof-of-work kernel: SHA-256 specialised to the 21-byte message salt ‖ 0x01 ‖ u32be(n).
// With its padding the message is a single 64-byte block of big-endian words:
//   W0–W3   salt                         fixed per card
//   W4      0x01 ‖ top 3 bytes of n      changes every 256 nonces
//   W5      low byte of n ‖ 0x80 ‖ 0 ‖ 0 (0x80 starts the padding)
//   W6–W14  0
//   W15     168, the message length in bits
// All arithmetic is int32 (`| 0`), which is what V8 compiles best.
// ---------------------------------------------------------------------------------------------

// prettier-ignore
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
// prettier-ignore
const IV = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const MESSAGE_BITS = (SALT_BYTES + 5) * 8;

const sig0 = (x: number): number => ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
const sig1 = (x: number): number => ((x >>> 17) | (x << 15)) ^ ((x >>> 19) | (x << 13)) ^ (x >>> 10);
const readWord = (bytes: Uint8Array, i: number): number =>
  (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];

/** SHA-256 rounds [from, to) on `state` in place, with kw[t] = K[t] + W[t]. Not used in the hot loop. */
function rounds(state: Int32Array, kw: Int32Array, from: number, to: number): void {
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  for (let t = from; t < to; t++) {
    const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + kw[t]) | 0;
    const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) | (c & (a | b)))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = a; state[1] = b; state[2] = c; state[3] = d; state[4] = e; state[5] = f; state[6] = g; state[7] = h;
}

/**
 * Full SHA-256 of salt ‖ domain ‖ u32be(nonce), written for clarity rather than speed. The kernel
 * uses it to confirm candidates, and the tests compare it with node:crypto.
 */
export function powDigest(salt: Uint8Array, domain: number, nonce: number): Uint8Array {
  const kw = new Int32Array(64);
  for (let i = 0; i < 4; i++) kw[i] = readWord(salt, 4 * i);
  kw[4] = (domain << 24) | (nonce >>> 8);
  kw[5] = (nonce << 24) | 0x00800000;
  kw[15] = MESSAGE_BITS;
  for (let t = 16; t < 64; t++) kw[t] = (sig1(kw[t - 2]) + kw[t - 7] + sig0(kw[t - 15]) + kw[t - 16]) | 0;
  for (let t = 0; t < 64; t++) kw[t] = (kw[t] + K[t]) | 0;
  const state = IV.slice();
  rounds(state, kw, 0, 64);
  const digest = new Uint8Array(DIGEST_BYTES);
  const view = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) view.setInt32(4 * i, (state[i] + IV[i]) | 0);
  return digest;
}

export interface PowSearch {
  /** Tests every nonce in [start, end), integers with 0 ≤ start ≤ end ≤ 2^32. Returns the match or -1. */
  scan(start: number, end: number): number;
}

/** Precomputes everything that does not depend on n for one card and returns its search function. */
export function createPowSearch(salt: Uint8Array, check: Uint8Array): PowSearch {
  if (salt.length !== SALT_BYTES || check.length !== DIGEST_BYTES) {
    throw new RangeError(`salt must be ${SALT_BYTES} bytes and check ${DIGEST_BYTES} bytes`);
  }
  const W = new Int32Array(64);
  const KW = new Int32Array(64); // K[t] + W[t], so a round costs one load
  for (let i = 0; i < 4; i++) W[i] = readWord(salt, 4 * i);
  W[15] = MESSAGE_BITS;
  // W16–W18 only read the salt and constants, because W9–W14 are zero.
  W[16] = (sig0(W[1]) + W[0]) | 0;
  W[17] = (sig1(W[15]) + sig0(W[2]) + W[1]) | 0;
  W[18] = (sig1(W[16]) + sig0(W[3]) + W[2]) | 0;
  const sig1W17 = sig1(W[17]);
  for (let t = 0; t < 64; t++) KW[t] = (K[t] + W[t]) | 0;

  // Rounds 0–3 only see the salt, so they run once here. Round 4 runs once per 256 nonces.
  const midstate = IV.slice();
  rounds(midstate, KW, 0, 4);
  const state = new Int32Array(8); // after round 4, for the current n >>> 8

  const target = new Int32Array(8);
  for (let i = 0; i < 8; i++) target[i] = readWord(check, 4 * i);
  // Rounds 61–63 only shift e into f, g and h, so after round 60 e already equals the final h.
  // Comparing e with H7 − IV7 rejects all but 2^-32 of the wrong nonces three rounds early.
  const wantE = (target[7] - IV[7]) | 0;

  // Hot loop over the low byte of n. It has its own small function because V8 optimises nested
  // hot loops badly (the same code inlined into scan measured 1.6× slower). Rounds are unrolled
  // 8× with rotating roles and Σ/Ch/Maj written out, so there are no calls or allocations.
  // Returns the first lo whose H7 matches, or -1.
  function block(lo: number, loEnd: number): number {
    const a0 = state[0], b0 = state[1], c0 = state[2], d0 = state[3];
    const e0 = state[4], f0 = state[5], g0 = state[6], h0 = state[7];
    for (; lo < loEnd; lo++) {
      const w5 = (lo << 24) | 0x00800000;
      W[5] = w5;
      KW[5] = (K[5] + w5) | 0;
      // Message schedule W20–W60. W61–W63 only feed rounds that we skip.
      for (let t = 20; t <= 60; t++) {
        const x = W[t - 15], y = W[t - 2];
        const w = ((((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + W[t - 7] +
          (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[t - 16]) | 0;
        W[t] = w;
        KW[t] = (K[t] + w) | 0;
      }
      let a = a0, b = b0, c = c0, d = d0, e = e0, f = f0, g = g0, h = h0;
      // Rounds 5–60, eight per pass: each line pair is h' = T1 → d += T1 → h' = T1 + T2.
      // prettier-ignore
      for (let t = 5; t <= 60; t += 8) {
        h = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + KW[t]) | 0;
        d = (d + h) | 0;
        h = (h + (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) | (c & (a | b)))) | 0;
        g = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + KW[t + 1]) | 0;
        c = (c + g) | 0;
        g = (g + (((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b & (h | a)))) | 0;
        f = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + KW[t + 2]) | 0;
        b = (b + f) | 0;
        f = (f + (((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h)))) | 0;
        e = (e + (((b >>> 6) | (b << 26)) ^ ((b >>> 11) | (b << 21)) ^ ((b >>> 25) | (b << 7))) + (d ^ (b & (c ^ d))) + KW[t + 3]) | 0;
        a = (a + e) | 0;
        e = (e + (((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g)))) | 0;
        d = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b ^ c))) + KW[t + 4]) | 0;
        h = (h + d) | 0;
        d = (d + (((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f)))) | 0;
        c = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b ^ (h & (a ^ b))) + KW[t + 5]) | 0;
        g = (g + c) | 0;
        c = (c + (((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e)))) | 0;
        b = (b + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + KW[t + 6]) | 0;
        f = (f + b) | 0;
        b = (b + (((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d)))) | 0;
        a = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + KW[t + 7]) | 0;
        e = (e + a) | 0;
        a = (a + (((b >>> 2) | (b << 30)) ^ ((b >>> 13) | (b << 19)) ^ ((b >>> 22) | (b << 10))) + ((b & c) | (d & (b | c)))) | 0;
      }
      if (e === wantE) return lo;
    }
    return -1;
  }

  const matches = (digest: Uint8Array): boolean => {
    for (let i = 0; i < 8; i++) if (readWord(digest, 4 * i) !== target[i]) return false;
    return true;
  };

  return {
    scan(start: number, end: number): number {
      if (!(start < end)) return -1;
      const firstHi = start >>> 8;
      const lastHi = (end - 1) >>> 8;
      for (let hi = firstHi; hi <= lastHi; hi++) {
        const w4 = (DOMAIN_CHECK << 24) | hi;
        const w19 = (sig1W17 + sig0(w4) + W[3]) | 0; // W12 = 0
        W[4] = w4;
        W[19] = w19;
        KW[4] = (K[4] + w4) | 0;
        KW[19] = (K[19] + w19) | 0;
        state.set(midstate);
        rounds(state, KW, 4, 5);
        const loStart = hi === firstHi ? start & 0xff : 0;
        const loEnd = hi === lastHi ? ((end - 1) & 0xff) + 1 : 256;
        for (let lo = block(loStart, loEnd); lo >= 0; lo = block(lo + 1, loEnd)) {
          // H7 matched (the answer, or a 2^-32 fluke): confirm the full digest.
          const nonce = hi * 256 + lo;
          if (matches(powDigest(salt, DOMAIN_CHECK, nonce))) return nonce;
        }
      }
      return -1;
    },
  };
}
