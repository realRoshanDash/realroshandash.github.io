/**
 * The palette's "/" shortcut setting, shared by the eager boot script and the palette module (kept apart from
 * palette.ts so the eager script stays tiny). WCAG 2.1.4: a single-key shortcut must be possible to turn off.
 */
export const SLASH_KEY = 'rd-slash';

/** On unless the visitor turned it off on this device. */
export function slashShortcutOn(): boolean {
  try {
    return localStorage.getItem(SLASH_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSlashShortcut(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SLASH_KEY);
    else localStorage.setItem(SLASH_KEY, 'off');
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
}

/** aria-keyshortcuts for the buttons that open the palette. */
export const keyShortcuts = (slash: boolean): string => (slash ? 'Control+K Meta+K /' : 'Control+K Meta+K');
