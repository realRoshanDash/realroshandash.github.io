/**
 * Header behaviour on every page (design spec §4.2–4.3, §8.3): scrolled state, reading progress (posts), the
 * platform's shortcut label, the ⌘K hand-off to the palette, the mobile menu and the layout-grid toggle.
 */
import { requestPalette } from './palette-bridge.ts';

const root = document.documentElement;
const header = document.querySelector<HTMLElement>('[data-header]');
const progress = header?.querySelector<HTMLElement>('.read-progress');

/* ---- scrolled state (+ reading progress where the bar exists) ---- */
let height = 0;
const measure = () => (height = root.scrollHeight - innerHeight);
let ticking = false;
function onScroll(): void {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const y = scrollY;
    header?.toggleAttribute('data-scrolled', y > 8);
    if (progress) progress.style.setProperty('--progress', height > 0 ? Math.min(1, y / height).toFixed(4) : '0');
    ticking = false;
  });
}
if (progress) {
  measure();
  new ResizeObserver(measure).observe(document.body);
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---- ⌘K / Ctrl+K: hand off to the palette (palette-bridge.ts) ---- */
const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
if (/mac|iphone|ipad/i.test(platform)) for (const kbd of document.querySelectorAll('[data-kbd]')) kbd.textContent = '⌘K'; // "macOS" in userAgentData
for (const button of document.querySelectorAll('[data-open-palette]')) {
  button.addEventListener('click', () => {
    setMenu(false, false);
    requestPalette('button');
  });
}
addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() === 'k' && requestPalette('shortcut')) event.preventDefault();
});

/* ---- layout grid (§3.8): [data-grid-toggle] buttons tint the columns. Session-only; no single-key shortcut. ---- */
const gridButtons = document.querySelectorAll<HTMLButtonElement>('[data-grid-toggle]');
export function toggleGrid(force?: boolean): boolean {
  const on = root.classList.toggle('show-grid', force);
  for (const button of gridButtons) {
    button.setAttribute('aria-pressed', String(on));
    const label = button.querySelector('[data-grid-label]');
    if (label) label.textContent = on ? 'Hide layout grid' : 'Show layout grid';
  }
  return on;
}
for (const button of gridButtons) button.addEventListener('click', () => toggleGrid());

/* ---- mobile menu ---- */
const menuButton = document.querySelector<HTMLButtonElement>('[data-menu]');
const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

function setMenu(open: boolean, restoreFocus = true): void {
  if (!menuButton || !menu || menu.hidden === !open) return;
  menu.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? 'Close' : 'Menu';
  root.classList.toggle('menu-open', open);
  for (const el of document.querySelectorAll<HTMLElement>('main, .site-footer')) el.inert = open;
  if (open) {
    if (!calm) {
      menu.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
      menu.querySelectorAll('.mobile-menu__list li').forEach((li, i) =>
        li.animate([{ transform: 'translateY(12px)' }, { transform: 'none' }], { duration: 240, delay: i * 30, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }),
      );
    }
    menu.querySelector<HTMLElement>('a')?.focus();
  } else if (restoreFocus) {
    menuButton.focus();
  }
}

menuButton?.addEventListener('click', () => setMenu(Boolean(menu?.hidden)));
for (const link of menu?.querySelectorAll('a') ?? []) link.addEventListener('click', () => setMenu(false, false));
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenu(false);
});
matchMedia('(width >= 1024px)').addEventListener('change', (event) => {
  if (event.matches) setMenu(false, false);
});
