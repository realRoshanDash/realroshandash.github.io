/**
 * [data-copy-link] buttons copy the page's canonical URL (the address to share, also from a local preview).
 * The label swaps to "Link copied" for 2 s, with no motion, and one polite status region announces it.
 */
const COPIED_MS = 2000;
const buttons = document.querySelectorAll<HTMLButtonElement>('button[data-copy-link]');

if (buttons.length) {
  const status = document.createElement('p');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  document.body.append(status);

  for (const button of buttons) {
    const label = button.querySelector<HTMLElement>('[data-copy-label]');
    const idle = label?.textContent ?? 'Copy link';
    let timer: number | undefined;
    button.addEventListener('click', async () => {
      const url = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.href;
      let ok = false;
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {
        // No clipboard (insecure context, permission denied): say so rather than pretend.
      }
      if (label) label.textContent = ok ? 'Link copied' : 'Couldn’t copy';
      status.textContent = ok ? 'Link copied.' : 'Couldn’t copy the link.';
      button.toggleAttribute('data-copied', ok);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (label) label.textContent = idle;
        button.removeAttribute('data-copied');
        status.textContent = '';
      }, COPIED_MS);
    });
  }
}

export {};
