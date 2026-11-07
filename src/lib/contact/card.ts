/**
 * Sealed contact card: the format, validation and decoding. No crypto and no proof-of-work kernel (those are in
 * seal.ts, which re-exports all of this), so a page can check the committed card and re-validate a cached copy
 * without loading them: the contact gate imports the solver, and with it seal.ts, on first use.
 * Runs unchanged in the browser, in workers and in Node ≥ 24 (type stripping); no dependencies.
 */

export const SEALED_VERSION = 1;
export const SEALED_ALG = 'AES-256-GCM';
/** Bits of proof-of-work. The expected work is 2^(d-1) hashes and the worst case is 2^d. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 32;

export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const DIGEST_BYTES = 32;
const TAG_BYTES = 16;

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

export function toBase64(bytes: Uint8Array): string {
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

export function toHex(bytes: Uint8Array): string {
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

export const isDifficulty = (d: unknown): d is number =>
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
