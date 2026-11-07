/**
 * The ⌘K command palette (design spec §4.5), loaded by palette-boot.ts on first use. It drives the
 * server-rendered <dialog> in CommandPalette.astro: a combobox over a grouped listbox, a preview pane, and
 * full-text search through Pagefind, imported from /pagefind/pagefind.js when the palette first opens (the index
 * exists only in built sites; without it the palette keeps working on its own pages, posts and actions).
 *
 * Keyboard: ↑/↓ move (wrapping), Home/End jump, Enter opens, ⌘/Ctrl+Enter opens in a new tab, Esc closes and
 * focus returns to the opener. ⌘K / Ctrl+K toggles it (header.ts). Theme, grid and email actions go through the
 * modules that own them (events and their own buttons), never around them.
 */
import {
  GROUP_LABELS,
  GROUP_ORDER,
  displayRoute,
  highlight,
  isApplePlatform,
  matchEntry,
  resultCount,
  type PaletteData,
  type PaletteGroup,
  type Range,
} from '../lib/palette.ts';

interface Item {
  /** Stable identity across renders: the page path, or the action's id. */
  key: string;
  group: PaletteGroup;
  label: string;
  url?: string;
  external?: boolean;
  /** Right-hand column: a route (mono) or a short word. */
  meta?: string;
  metaIsRoute?: boolean;
  /** Preview pane. */
  route?: string;
  description?: string;
  /** Pagefind excerpt: text with <mark> around the matches. */
  excerpt?: string;
  info?: string;
  keywords?: readonly string[];
  run?: () => void;
  score: number;
  ranges: readonly Range[];
}

/* Pagefind's browser API, the parts used here (https://pagefind.app/docs/api/). */
interface PagefindData {
  url: string;
  excerpt: string;
  /** title, plus date and minutes on posts (data-pagefind-meta in src/pages/blog/[...id].astro) */
  meta: { title?: string; date?: string; minutes?: string };
  sub_results?: { title: string; url: string; excerpt: string; locations?: number[] }[];
}
interface Pagefind {
  options(options: Record<string, unknown>): Promise<void>;
  init(): Promise<void>;
  search(term: string): Promise<{ results: { data(): Promise<PagefindData> }[] } | null>;
}

const PAGEFIND = '/pagefind/pagefind.js';
const SEARCH_DELAY = 120; // ms after the last keystroke (spec: debounced 120 ms)
const ANNOUNCE_DELAY = 400; // ms after typing stops before the count is read out
const MAX_HITS = 6; // spec §4.5: the first 6 Pagefind hits
const LATEST = 3;
const SCORE_POST_HIT = 35; // full-text hits rank below label matches; posts just above pages
const SCORE_PAGE_HIT = 30;

const NS = 'http://www.w3.org/2000/svg';
function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}
const ARROW_UP_RIGHT = 'M4.5 11.5l7-7M5.5 4.5h6v6';

function span(className: string, text?: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** Pagefind's excerpt as DOM: text, plus <mark> for the matches. Nothing else survives. */
function excerptNodes(html: string): Node[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  return [...template.content.childNodes].map((node) => {
    if (node.nodeName !== 'MARK') return document.createTextNode(node.textContent ?? '');
    const mark = document.createElement('mark');
    mark.textContent = node.textContent;
    return mark;
  });
}

function marked(text: string, ranges: readonly Range[]): Node[] {
  return highlight(text, ranges).map(({ text: run, mark }) => {
    if (!mark) return document.createTextNode(run);
    const el = document.createElement('mark');
    el.textContent = run;
    return el;
  });
}

const pathOf = (url: string) => new URL(url, location.origin).pathname;
const visible = (el: Element) =>
  el.isConnected && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);

export function mount(dialog: HTMLDialogElement) {
  const find = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
  const input = find<HTMLInputElement>('[data-palette-input]');
  const list = find<HTMLElement>('[data-palette-list]');
  const note = find<HTMLElement>('[data-palette-note]');
  const empty = find<HTMLElement>('[data-palette-empty]');
  const emptyTitle = find<HTMLElement>('[data-palette-empty-title]');
  const emptyHint = find<HTMLElement>('[data-palette-empty-hint]');
  const count = find<HTMLElement>('[data-palette-count]');
  const live = find<HTMLElement>('[data-palette-live]');
  const preview = {
    route: find<HTMLElement>('[data-p-route]'),
    title: find<HTMLElement>('[data-p-title]'),
    desc: find<HTMLElement>('[data-p-desc]'),
    meta: find<HTMLElement>('[data-p-meta]'),
  };
  const data = JSON.parse(find('[data-palette-data]').textContent || '{}') as PaletteData;
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  const apple = isApplePlatform(platform);
  if (apple) find('[data-palette-mod]').textContent = '⌘';
  if (import.meta.env.DEV) note.textContent = 'Full-text search unavailable in dev: it runs on the built site (npm run build, then npm run preview).';

  /* ---------------------------------------------------------------- static entries */
  const pages: Item[] = data.pages.map((page) => ({
    key: pathOf(page.url) + new URL(page.url, location.origin).hash,
    group: 'pages',
    label: page.label,
    url: page.url,
    meta: displayRoute(page.url, location.origin),
    metaIsRoute: true,
    route: displayRoute(page.url, location.origin),
    description: page.description,
    keywords: page.keywords,
    score: 0,
    ranges: [],
  }));
  const posts: Item[] = data.posts.map((post) => ({
    key: pathOf(post.url),
    group: 'writing',
    label: post.label,
    url: post.url,
    meta: `${post.draft ? 'Draft · ' : ''}${post.minutes} min`,
    route: displayRoute(post.url, location.origin),
    description: post.description,
    info: [post.date, `${post.minutes} min`, post.tags.join(', '), post.draft && 'Draft'].filter(Boolean).join(' · '),
    keywords: post.tags,
    score: 0,
    ranges: [],
  }));
  const elsewhere: Item[] = data.elsewhere.map((link) => ({
    key: link.url,
    group: 'elsewhere',
    label: link.label,
    url: link.url,
    external: true,
    meta: displayRoute(link.url, location.origin),
    metaIsRoute: true,
    route: displayRoute(link.url, location.origin),
    description: link.description,
    info: 'External link',
    keywords: link.keywords,
    score: 0,
    ranges: [],
  }));
  const pageByPath = new Map(pages.filter((page) => !new URL(page.url!, location.origin).hash).map((page) => [page.key, page]));
  const postByPath = new Map(posts.map((post) => [post.key, post]));

  /* ---------------------------------------------------------------- actions */
  let copied: string | null = null;
  let copiedTimer = 0;

  const action = (key: string, label: string, meta: string, description: string, info: string, keywords: string[], run: () => void): Item => ({
    key: `action:${key}`, group: 'actions', label, meta, description, info, keywords, run, score: 0, ranges: [],
  });

  function actions(): Item[] {
    const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
    const next = theme === 'dark' ? 'light' : 'dark';
    const system = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const grid = root.classList.contains('show-grid');
    return [
      action('theme', `Switch to ${next} theme`, 'Theme',
        next === 'light' ? 'Paper: dark ink on a warm white page.' : 'Ink: light text on a near-black page.',
        'Remembered on this device', ['dark', 'light', 'mode', 'appearance', 'colour', 'color'], () => requestTheme('toggle')),
      action('system', 'Use system theme', 'Theme', 'Follow your device’s light or dark setting.',
        `Your device is set to ${system}`, ['system', 'auto', 'device', 'os', 'dark', 'light', 'mode'], () => requestTheme('system')),
      action('grid', 'Toggle layout grid', 'Layout', 'Tint the twelve columns this page is set on. For this visit only.',
        `Layout grid · ${grid ? 'On' : 'Off'}`, ['grid', 'columns', 'layout', 'design', 'show', 'hide'], toggleGrid),
      action('verify', 'Verify and reveal email', 'Contact',
        'A short proof-of-work in your browser — about a second — decrypts the address. No tracking.',
        'Proof of work · SHA-256', ['email', 'mail', 'contact', 'captcha', 'proof of work', 'address'], verify),
      action('copy', copied ?? 'Copy page link', 'Link', `Copies ${pageLink()} to the clipboard.`, 'Clipboard',
        ['copy', 'url', 'share', 'clipboard', 'permalink'], () => void copyLink()),
    ];
  }

  function requestTheme(detail: 'toggle' | 'system') {
    close();
    const handled = !dispatchEvent(new CustomEvent('theme:request', { detail, cancelable: true }));
    if (!handled && detail === 'toggle') document.querySelector<HTMLButtonElement>('[data-theme-toggle]')?.click();
  }

  function toggleGrid() {
    close();
    const button = document.querySelector<HTMLButtonElement>('[data-grid-toggle]');
    if (button) button.click();
    else root.classList.toggle('show-grid');
  }

  function verify() {
    const gate = document.querySelector<HTMLElement>('[data-gate]');
    close(false);
    if (!gate) {
      location.assign(data.verify);
      return;
    }
    // The gate is on this page: start it (the visitor asked to) and bring it into view.
    gate.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    const start = gate.querySelector<HTMLButtonElement>('[data-start]');
    if (start && !start.disabled) {
      start.focus({ preventScroll: true });
      start.click();
    }
  }

  const pageLink = () => document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? location.href.split('#')[0];

  async function copyLink() {
    const url = pageLink();
    let ok = false;
    try {
      await navigator.clipboard.writeText(url); // HTTPS (and localhost) only; the site is served over HTTPS
      ok = true;
    } catch {
      ok = false;
    }
    copied = ok ? 'Link copied' : `Couldn’t copy — the link is ${url}`;
    announce(ok ? 'Link copied.' : `Couldn’t copy. The link is ${url}`);
    refresh();
    clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied = null;
      if (dialog.open) refresh();
    }, 2000);
  }

  /* ---------------------------------------------------------------- Pagefind */
  let pagefind: Pagefind | null | undefined; // undefined: loading or not tried; null: unavailable
  let pagefindLoad: Promise<Pagefind | null> | undefined;
  function loadPagefind(): Promise<Pagefind | null> {
    pagefindLoad ??= (async () => {
      if (import.meta.env.DEV) return null; // the index exists only in a built site
      try {
        const url = PAGEFIND; // a variable, so the bundler leaves the import alone
        const api = (await import(/* @vite-ignore */ url)) as Pagefind;
        await api.options({ excerptLength: 24 });
        await api.init();
        return api;
      } catch {
        return null;
      }
    })().then((api) => {
      pagefind = api;
      if (!api && dialog.open && query) update(); // show the "unavailable" note for the current query
      return api;
    });
    return pagefindLoad;
  }

  function toHit(result: PagefindData): Item {
    // Deep-link to the section with the most matches when the page has headings with ids.
    const sections = (result.sub_results ?? []).filter((sub) => sub.locations?.length);
    const best = sections.sort((a, b) => (b.locations?.length ?? 0) - (a.locations?.length ?? 0))[0];
    const deep = best && new URL(best.url, location.origin).hash ? best : undefined;
    const path = pathOf(result.url);
    const post = postByPath.get(path);
    const page = pageByPath.get(path);
    const base = post ?? page;
    // Only the latest posts ship with the page (palette-data.ts): older ones read their date and minutes from the index.
    const { date, minutes } = result.meta;
    return {
      key: path,
      group: post || (/^\/blog\/(?!tags\/)[^/]+\/$/.test(path) && !page) ? 'writing' : 'pages',
      label: base?.label ?? result.meta.title ?? displayRoute(path, location.origin),
      url: deep?.url ?? result.url,
      meta: base?.meta ?? (minutes ? `${minutes} min` : displayRoute(path, location.origin)),
      metaIsRoute: base ? base.metaIsRoute : !minutes,
      route: displayRoute(path, location.origin),
      excerpt: deep?.excerpt ?? result.excerpt,
      info: [base?.info ?? (date && minutes ? `${date} · ${minutes} min` : undefined), deep && deep.title !== result.meta.title ? `Section · ${deep.title}` : '']
        .filter(Boolean).join(' · ') || undefined,
      score: post ? SCORE_POST_HIT : SCORE_PAGE_HIT,
      ranges: [],
    };
  }

  /* ---------------------------------------------------------------- state */
  let query = '';
  let hits: { q: string; items: Item[] } = { q: '', items: [] }; // the last full-text results
  let items: Item[] = [];
  let options: HTMLElement[] = [];
  let groupHeads = new Map<number, HTMLElement>(); // first option index → its group's label
  let active = 0;
  let shownQuery: string | null = null; // the query the list on screen belongs to
  let token = 0;
  let pending: Promise<void> | null = null;
  let settle: () => void = () => {}; // resolves `pending` (also when a newer keystroke supersedes it)
  let searchTimer = 0;
  let announceTimer = 0;
  let opener: Element | null = null;
  let restoreFocus = true;

  function local(q: string): Item[] {
    const out: Item[] = [];
    for (const item of [...pages, ...posts, ...actions(), ...elsewhere]) {
      const match = matchEntry(q, item.label, item.keywords);
      if (match) out.push({ ...item, score: match.score, ranges: match.ranges });
    }
    return out;
  }

  function idle(): Item[] {
    return [...pages, ...posts.slice(0, LATEST), ...actions(), ...elsewhere];
  }

  /**
   * Full-text hits merged into the label matches: one row per page, with the excerpt and the best score. A hit
   * whose own title matches (a tag page called "vim") is highlighted and leads its group, but stays below label
   * matches of pages, posts and actions so it never pushes a better group down.
   */
  function merge(matches: Item[], found: Item[], q: string): Item[] {
    const byKey = new Map(matches.map((item) => [item.key, item]));
    const extra: Item[] = [];
    for (const hit of found) {
      const known = byKey.get(hit.key);
      if (known) {
        Object.assign(known, { url: hit.url, excerpt: hit.excerpt, info: hit.info ?? known.info, score: Math.max(known.score, hit.score) });
        continue;
      }
      const titled = matchEntry(q, hit.label);
      extra.push(titled ? { ...hit, ranges: titled.ranges, score: hit.score + Math.min(20, titled.score) } : hit);
    }
    return [...matches, ...extra];
  }

  /** Group, rank (best group first while searching; stable, so ties keep the default order) and flatten. */
  function arrange(list: Item[], searching: boolean): { group: PaletteGroup; items: Item[] }[] {
    const groups = GROUP_ORDER.map((group) => ({ group, items: list.filter((item) => item.group === group) })).filter(
      (group) => group.items.length > 0,
    );
    if (searching) {
      for (const group of groups) group.items.sort((a, b) => b.score - a.score);
      groups.sort((a, b) => b.items[0].score - a.items[0].score);
    }
    return groups;
  }

  /* ---------------------------------------------------------------- rendering */
  function render(next: Item[], { q, ms, settled }: { q: string; ms?: number; settled: boolean }) {
    const keep = shownQuery === q ? items[active]?.key : undefined;
    const groups = arrange(next, q !== '');
    items = groups.flatMap((group) => group.items);
    options = [];
    groupHeads = new Map();
    const fragment = document.createDocumentFragment();
    for (const { group, items: members } of groups) {
      const wrap = document.createElement('div');
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-labelledby', `palette-group-${group}`);
      const head = document.createElement('div');
      head.className = 'palette__group label';
      head.id = `palette-group-${group}`;
      head.textContent = GROUP_LABELS[group];
      wrap.append(head);
      groupHeads.set(options.length, head);
      for (const item of members) wrap.append(row(item, options.length));
      fragment.append(wrap);
    }
    list.replaceChildren(fragment);
    if (shownQuery !== q) list.scrollTop = 0;
    shownQuery = q;

    const unavailable = q !== '' && pagefind === null;
    note.hidden = !unavailable;
    const nothing = q !== '' && items.length === 0 && settled;
    empty.hidden = !nothing;
    if (nothing) {
      emptyTitle.textContent = `Nothing matches “${q}”.`;
      emptyHint.textContent = data.posts.length
        ? 'Try a topic like “java” or “agents”.'
        : 'There are no posts yet — try a page or an action.';
    }
    input.setAttribute('aria-expanded', String(items.length > 0));
    dialog.toggleAttribute('data-empty', items.length === 0);
    count.textContent = q ? resultCount(items.length, ms) : '';

    const kept = keep ? items.findIndex((item) => item.key === keep) : -1;
    select(kept >= 0 ? kept : 0, kept < 0);
    if (q && settled) {
      clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => announce(items.length ? resultCount(items.length) : 'No results'), ANNOUNCE_DELAY);
    }
  }

  function row(item: Item, index: number): HTMLElement {
    const el = document.createElement(item.url ? 'a' : 'div');
    if (el instanceof HTMLAnchorElement && item.url) {
      el.href = item.url;
      el.tabIndex = -1;
      if (item.external) el.rel = 'noopener';
    }
    el.id = `palette-option-${index}`;
    el.className = 'palette__item';
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', 'false');
    el.dataset.index = String(index);

    const n = span('palette__n', String(index + 1).padStart(2, '0'));
    n.setAttribute('aria-hidden', 'true');
    const label = span('palette__label');
    label.append(...marked(item.label, item.ranges));
    if (item.external) label.append(icon(ARROW_UP_RIGHT));
    const main = span('palette__main');
    main.append(label);
    const sub = item.excerpt ? excerptNodes(item.excerpt) : item.group === 'writing' && item.description ? [document.createTextNode(item.description)] : null;
    if (sub) {
      const line = span('palette__sub');
      line.append(...sub);
      main.append(line);
    }
    el.append(n, main, span(item.metaIsRoute ? 'palette__meta palette__meta--route' : 'palette__meta', item.meta));
    options.push(el);
    return el;
  }

  function select(index: number, scroll = true) {
    if (items.length === 0) {
      input.removeAttribute('aria-activedescendant');
      show(null);
      return;
    }
    active = (index + items.length) % items.length;
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
    const option = options[active];
    input.setAttribute('aria-activedescendant', option.id);
    if (scroll) {
      if (active === 0) list.scrollTop = 0;
      else (groupHeads.get(active) ?? option).scrollIntoView({ block: 'nearest' });
      option.scrollIntoView({ block: 'nearest' });
    }
    show(items[active]);
  }

  function show(item: Item | null) {
    preview.route.textContent = item?.route ?? '';
    preview.title.textContent = item?.label ?? '';
    preview.desc.replaceChildren(...(item?.excerpt ? excerptNodes(item.excerpt) : [document.createTextNode(item?.description ?? '')]));
    preview.meta.textContent = item?.info ?? '';
  }

  function announce(message: string) {
    live.textContent = '';
    window.setTimeout(() => (live.textContent = message), 50);
  }

  /* ---------------------------------------------------------------- searching */
  function update() {
    const q = input.value.trim();
    query = q;
    const mine = ++token;
    clearTimeout(searchTimer);
    clearTimeout(announceTimer);
    settle();
    pending = null;
    if (!q) {
      render(idle(), { q, settled: true });
      return;
    }
    const matches = local(q);
    if (pagefind === null) {
      render(matches, { q, settled: true });
      return;
    }
    // Label matches show at once; full-text hits join them a moment later. While nothing matches locally the
    // previous list stays up until the hits land, so the list doesn't flash empty on every keystroke.
    if (matches.length > 0 || shownQuery === null) render(matches, { q, settled: false });
    pending = new Promise<void>((resolve) => {
      settle = resolve;
      searchTimer = window.setTimeout(async () => {
        try {
          const api = await loadPagefind();
          if (mine !== token) return;
          if (!api) return render(matches, { q, settled: true });
          const started = performance.now();
          const search = await api.search(q);
          const results = await Promise.all((search?.results ?? []).slice(0, MAX_HITS).map((result) => result.data()));
          if (mine !== token) return;
          hits = { q, items: results.map(toHit) };
          render(merge(local(q), hits.items, q), { q, ms: performance.now() - started, settled: true });
        } catch {
          if (mine === token) render(matches, { q, settled: true });
        } finally {
          resolve();
        }
      }, SEARCH_DELAY);
    });
  }

  /** Re-render the current query in place (an action changed a label), keeping the selection. */
  function refresh() {
    if (!query) return render(idle(), { q: '', settled: true });
    render(merge(local(query), hits.q === query ? hits.items : [], query), { q: query, settled: true });
  }

  /* ---------------------------------------------------------------- opening, closing, activating */
  function start() {
    restoreFocus = true;
    shownQuery = null;
    update();
    input.focus();
    void loadPagefind();
  }

  function open(from: Element | null) {
    if (dialog.open) return;
    opener = from;
    input.value = '';
    dialog.showModal();
    start();
  }

  function close(restore = true) {
    if (!dialog.open) return;
    restoreFocus = restore;
    dialog.close();
  }

  dialog.addEventListener('close', () => {
    token++;
    clearTimeout(searchTimer);
    clearTimeout(announceTimer);
    settle();
    pending = null;
    input.value = '';
    query = '';
    shownQuery = null;
    if (restoreFocus) {
      const back = opener instanceof HTMLElement && opener !== document.body && visible(opener)
        ? opener
        : [...document.querySelectorAll<HTMLElement>('[data-open-palette]')].find(visible);
      back?.focus({ preventScroll: true });
    }
  });

  function activate(item: Item, newTab = false) {
    if (item.run) return item.run();
    if (!item.url) return;
    if (newTab) {
      window.open(item.url, '_blank', 'noopener');
      return;
    }
    close(false);
    location.assign(item.url);
  }

  async function enter(newTab: boolean) {
    // The list may still be catching up with the last keystroke: wait for the newest search to land.
    for (let last: Promise<void> | null = null; pending && pending !== last; ) await (last = pending);
    if (!dialog.open) return;
    const item = items[active];
    if (item) activate(item, newTab);
  }

  /* ---------------------------------------------------------------- events */
  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const plain = !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        select(active + (event.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Home':
      case 'End':
        if (!plain || items.length === 0) return;
        event.preventDefault();
        select(event.key === 'Home' ? 0 : items.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        void enter(event.metaKey || event.ctrlKey);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
    }
  });
  // Esc belongs to the palette while it is open (the mobile menu listens for it on window too).
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  // Rows: hover selects, click opens. Modified clicks on links are left to the browser (new tab / window).
  list.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the input
  list.addEventListener('pointermove', (event) => {
    const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (option && Number(option.dataset.index) !== active) select(Number(option.dataset.index), false);
  });
  list.addEventListener('click', (event) => {
    const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
    const item = option && items[Number(option.dataset.index)];
    if (!item) return;
    if (item.url && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    event.preventDefault();
    activate(item);
  });

  find<HTMLButtonElement>('[data-palette-close]').addEventListener('click', () => close());

  // A click on the backdrop (outside the panel) closes; a drag that merely ends there doesn't.
  let downOutside = false;
  const outside = (event: MouseEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  dialog.addEventListener('pointerdown', (event) => (downOutside = event.target === dialog && outside(event)));
  dialog.addEventListener('click', (event) => {
    if (downOutside && event.target === dialog && outside(event)) close();
    downOutside = false;
  });

  return {
    /** The shell was already opened by palette-boot.ts; take over (keeping anything typed meanwhile). */
    adopt(from: Element | null) {
      opener = from;
      start();
    },
    toggle() {
      if (dialog.open) close();
      else open(document.activeElement);
    },
  };
}
