/**
 * Contact-card tab-session cache: once solved, the card stays revealed until the tab closes. Keys include part of
 * `check`, so re-sealing the card invalidates old entries. Storage failures (private mode, quota, disabled
 * storage) degrade to "not cached". Apart from solver.ts so that the page can show a cached card on load without
 * loading the solver, the cipher and the proof-of-work kernel.
 */
import { parseContact, type Contact, type SealedContact } from '../../lib/contact/card.ts';

const cacheKey = (sealed: SealedContact) => `contact-card:v${sealed.v}:${sealed.check.slice(0, 16)}`;

const storage = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
};

/** The card solved earlier in this tab, or null. The value is re-validated, never trusted. */
export function readCachedContact(sealed: SealedContact): Contact | null {
  try {
    const raw = storage()?.getItem(cacheKey(sealed));
    return raw ? parseContact(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCachedContact(sealed: SealedContact, contact: Contact): void {
  try {
    storage()?.setItem(cacheKey(sealed), JSON.stringify(parseContact(contact)));
  } catch {
    // not cached; the visitor solves again next time
  }
}

export function clearCachedContact(sealed: SealedContact): void {
  try {
    storage()?.removeItem(cacheKey(sealed));
  } catch {
    // nothing to clear
  }
}
