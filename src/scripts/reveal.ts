/**
 * Scroll reveals as progressive enhancement (design spec §3.4). Only [data-reveal] elements that are below the fold
 * at load are animated, with WAAPI, and the trigger fires just *before* they enter the viewport — nothing is ever
 * hidden by CSS, so no-JS, print, anchor jumps and failed observers all show the final state.
 */
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!calm && 'IntersectionObserver' in window && 'animate' in Element.prototype) {
  const fold = innerHeight;
  const items = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter(
    (el) => el.getBoundingClientRect().top > fold,
  );
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const index = Number((entry.target as HTMLElement).dataset.reveal || 0); // stagger 0–4
        entry.target.animate(
          [
            { opacity: 0, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 600, delay: Math.min(index, 4) * 60, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' },
        );
      }
    },
    { rootMargin: '0px 0px 12% 0px' },
  );
  for (const item of items) io.observe(item);
}

export {};
