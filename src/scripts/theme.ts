/**
 * Theme switching (design spec §4.4). The inline head script in Base.astro has already set <html data-theme>
 * before first paint (a stored choice, else the system preference); this module only handles changes.
 */
export type Theme = 'light' | 'dark';

const KEY = 'rd-theme';
const BG: Record<Theme, string> = { dark: '#0B0B0C', light: '#F2F1EC' };
const root = document.documentElement;
const systemLight = matchMedia('(prefers-color-scheme: light)');
const system = (): Theme => (systemLight.matches ? 'light' : 'dark');

export const currentTheme = (): Theme => (root.dataset.theme === 'light' ? 'light' : 'dark');

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function syncControls(theme: Theme): void {
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  for (const button of document.querySelectorAll('[data-theme-toggle]')) button.setAttribute('aria-label', label);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', BG[theme]);
}

function apply(theme: Theme): void {
  root.dataset.theme = theme;
  syncControls(theme);
  dispatchEvent(new CustomEvent('theme:change', { detail: { theme } }));
}

function swap(theme: Theme): void {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm || typeof document.startViewTransition !== 'function') return apply(theme);
  root.classList.add('theme-switching');
  const transition = document.startViewTransition(() => apply(theme));
  transition.finished.finally(() => root.classList.remove('theme-switching'));
}

/** An explicit choice: remembered across visits. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  swap(theme);
}

/** Forget the choice and follow the operating system again (the ⌘K action "Use system theme"). */
export function useSystemTheme(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  swap(system());
}

export const toggleTheme = (): void => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');

syncControls(currentTheme());
for (const button of document.querySelectorAll('[data-theme-toggle]')) button.addEventListener('click', toggleTheme);
systemLight.addEventListener('change', () => {
  if (!stored()) apply(system());
});
