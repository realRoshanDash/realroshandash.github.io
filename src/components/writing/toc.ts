/**
 * Post pages (design spec §4.18): the current section in the contents and READ %.
 *
 * - READ % is the header bar's value (scrollY over the scrollable height, header.ts), as a bar and as text. It is
 *   information, so it updates under reduced motion too.
 * - The current section is the last heading above a line 30% down the viewport; at the end of the page, the last.
 *   Heading positions and the page height are measured on load and whenever the page resizes (images, fonts, an
 *   opened <details>), never per frame, and a fast jump (End, a dragged scrollbar) can't skip a section.
 * - Writes happen in one rAF per scroll burst, and only when a value changes.
 */
const root = document.documentElement;
const links = [...document.querySelectorAll<HTMLAnchorElement>('a[data-toc-link]')];
const ids = [...new Set(links.map((link) => link.dataset.tocLink ?? ''))].filter(Boolean);
const headings = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
const bar = document.querySelector<HTMLElement>('[data-read-bar]');
const pct = document.querySelector<HTMLElement>('[data-read-pct]');
const list = document.querySelector<HTMLElement>('[data-toc-list]');

let max = 0;
let tops: number[] = [];
let current: string | undefined;
let shown = '';

function measure(): void {
  max = root.scrollHeight - innerHeight;
  const y = scrollY;
  tops = headings.map((heading) => heading.getBoundingClientRect().top + y);
}

/** Keep the current entry visible when the desktop list scrolls on its own (long contents). */
function reveal(link: HTMLElement): void {
  if (!list || list.scrollHeight <= list.clientHeight) return;
  const top = link.offsetTop - list.offsetTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + link.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + link.offsetHeight - list.clientHeight;
}

function setCurrent(id: string | undefined): void {
  if (id === current) return;
  current = id;
  for (const link of links) {
    if (link.dataset.tocLink === id) {
      link.setAttribute('aria-current', 'true');
      if (list?.contains(link)) reveal(link);
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

function update(): void {
  const y = scrollY;
  const progress = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
  bar?.style.setProperty('--progress', progress.toFixed(4));
  const text = `${Math.round(progress * 100)}%`;
  if (pct && text !== shown) pct.textContent = shown = text;

  if (!headings.length) return;
  const line = y + innerHeight * 0.3;
  let id: string | undefined;
  for (let i = 0; i < tops.length && tops[i] <= line; i++) id = headings[i].id;
  if (max > 0 && y >= max - 2) id = headings[headings.length - 1].id;
  setCurrent(id);
}

let ticking = false;
function schedule(): void {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    update();
  });
}

if (bar || headings.length) {
  const remeasure = () => {
    measure();
    schedule();
  };
  measure();
  update();
  // body resizes: images, fonts, an opened <details>; window resizes: the viewport height alone (phone toolbars)
  new ResizeObserver(remeasure).observe(document.body);
  addEventListener('resize', remeasure, { passive: true });
  addEventListener('load', remeasure);
  addEventListener('scroll', schedule, { passive: true });
}

export {};
