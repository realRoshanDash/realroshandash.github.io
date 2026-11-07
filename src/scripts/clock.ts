/**
 * Local time in Singapore for every [data-clock] ("16:22 SGT"), updated on the minute boundary and when the tab
 * becomes visible again (design spec §3.9). It writes into a fixed-width tabular box, so it can't relayout
 * anything, and it is not a live region. The server renders "UTC+08:00" for no-JS.
 */
const format = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
let timer: number | undefined;

function tick(): void {
  const time = format.format(new Date());
  for (const el of document.querySelectorAll<HTMLElement>('[data-clock]')) {
    const text = el.dataset.clock === 'hm' ? time : `${time} SGT`;
    if (el.textContent !== text) el.textContent = text;
  }
  clearTimeout(timer);
  timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});
tick();

export {};
