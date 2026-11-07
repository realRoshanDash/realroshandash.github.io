/**
 * Scroll reveals as progressive enhancement (design spec §3.4). Only [data-reveal] elements that are below the fold
 * at load are animated, with WAAPI, and the trigger fires just *before* they enter the viewport — nothing is ever
 * hidden by CSS, so no-JS, print and failed observers all show the final state.
 *
 * Only real scroll-ins animate. A block that is already well inside the viewport when the observer reports it got
 * there by a jump (an in-page link, a hash, Tab moving focus), so it is shown as it is: the target of a jump, and
 * the focus ring on it, must never fade in from nothing. Focus moving into a block, or a hash change, also ends any
 * reveal still running there.
 */
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!calm && 'IntersectionObserver' in window && 'animate' in Element.prototype) {
  const fold = innerHeight;
  const items = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter(
    (el) => el.getBoundingClientRect().top > fold,
  );
  const running = new Set<Animation>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        if (entry.boundingClientRect.top < innerHeight * 0.85) continue; // arrived by a jump: final state
        const index = Number((entry.target as HTMLElement).dataset.reveal || 0); // stagger 0–4
        const animation = entry.target.animate(
          [
            { opacity: 0, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 600, delay: Math.min(index, 4) * 60, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' },
        );
        running.add(animation);
        animation.finished.finally(() => running.delete(animation)).catch(() => {});
      }
    },
    { rootMargin: '0px 0px 12% 0px' },
  );
  for (const item of items) io.observe(item);

  /** Show `target`'s blocks in their final state now, and never animate them later. */
  const settle = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    for (const block of items) {
      if (block.contains(target) || target.contains(block)) io.unobserve(block);
    }
    for (const animation of running) {
      const el = (animation.effect as KeyframeEffect | null)?.target;
      if (el && (el.contains(target) || target.contains(el))) animation.finish();
    }
  };
  addEventListener('focusin', (event) => settle(event.target));
  addEventListener('hashchange', () => settle(document.getElementById(decodeURIComponent(location.hash.slice(1)))));
}

export {};
