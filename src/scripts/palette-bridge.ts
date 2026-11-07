/**
 * Front door of the ⌘K command palette. Search buttons and shortcuts announce `palette:open` on window; the
 * palette (its own module) listens and calls `event.preventDefault()` to claim the request.
 *
 *   addEventListener('palette:open', (event) => { event.preventDefault(); open(event.detail); });
 *
 * Shortcuts only take over the browser's own ⌘K / Ctrl+K / "/" when the request was claimed, so nothing is
 * swallowed on a page that has no palette.
 */
export interface PaletteOpenDetail {
  source: 'button' | 'shortcut';
}

declare global {
  interface WindowEventMap {
    'palette:open': CustomEvent<PaletteOpenDetail>;
  }
}

/** Ask for the palette; true when a palette claimed the request. */
export function requestPalette(source: PaletteOpenDetail['source']): boolean {
  const event = new CustomEvent<PaletteOpenDetail>('palette:open', { cancelable: true, detail: { source } });
  return !dispatchEvent(event);
}
