/**
 * Display helpers for the dormant notes section. Pure (no Astro imports), so `node --test` covers them.
 */

/**
 * A link as people read it: no scheme, no "www.", no trailing slash, query or fragment, and at most `max`
 * characters (cut at a path segment where possible). Percent-escapes are decoded when they form valid UTF-8; a
 * path that doesn't decode (a bare "%", Latin-1 escapes) is shown as written rather than failing the build.
 *   https://www.example.com/docs/guide/ → example.com/docs/guide
 */
export function displayUrl(href: string, max = 48): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const host = url.hostname.replace(/^www\./, '');
  let decoded = url.pathname;
  try {
    decoded = decodeURI(decoded);
  } catch {
    /* malformed escape: keep it encoded */
  }
  const path = decoded.replace(/\/+$/, '');
  const full = `${host}${path}`;
  if (full.length <= max) return full;
  const room = max - host.length - 2; // "/…"
  if (room <= 0) return host;
  const kept = path.slice(0, room + 1);
  const cut = kept.lastIndexOf('/');
  return `${host}${cut > 0 ? kept.slice(0, cut) : kept.slice(0, room)}/…`;
}
