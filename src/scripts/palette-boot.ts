/**
 * The palette's eager part, on every page (~0.5 KB): it claims `palette:open` requests — the header's search
 * buttons and ⌘K / Ctrl+K (header.ts), and "/" (here) — and loads the palette module the first time one arrives.
 * The dialog shell is server-rendered, so the first open is instant and the module fills it in when it lands.
 *
 * "/" opens the palette only outside text fields and without modifier keys, and the visitor can turn it off from
 * the palette ("Turn off the / shortcut", stored on the device), which WCAG 2.1.4 requires of single-key shortcuts.
 */
import { requestPalette } from './palette-bridge.ts';
import { keyShortcuts, slashShortcutOn } from '../lib/palette-shortcut.ts';

type PaletteModule = typeof import('./palette.ts');
type Palette = ReturnType<PaletteModule['mount']>;

const dialog = document.querySelector<HTMLDialogElement>('dialog[data-palette]');

if (dialog) {
  let palette: Palette | undefined;
  let loading: Promise<PaletteModule> | undefined;
  const load = () => (loading ??= import('./palette.ts'));

  addEventListener('palette:open', (event) => {
    event.preventDefault(); // claimed: the shortcut doesn't fall through to the browser
    if (palette) return palette.toggle();
    if (dialog.open) return;
    const opener = document.activeElement;
    dialog.showModal(); // the shell, focused on its input (autofocus)
    load()
      .then((module) => {
        palette = module.mount(dialog);
        if (dialog.open) palette.adopt(opener);
      })
      .catch((error: unknown) => {
        dialog.close();
        loading = undefined;
        console.error('[palette] failed to load', error);
      });
  });

  // Warm the module up when someone heads for a search button.
  for (const button of document.querySelectorAll('[data-open-palette]')) {
    button.addEventListener('pointerenter', () => void load().catch(() => (loading = undefined)), { once: true });
    button.setAttribute('aria-keyshortcuts', keyShortcuts(slashShortcutOn()));
  }

  const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

  addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.defaultPrevented) return;
    if (dialog.open || typing(event.target) || !slashShortcutOn()) return;
    if (requestPalette('shortcut')) event.preventDefault();
  });
}
