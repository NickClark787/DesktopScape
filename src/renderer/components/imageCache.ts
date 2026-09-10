/**
 * Shared in-memory denylist for OSRS Wiki CDN URLs that have already 404'd
 * during this session. The CDN is missing icons for ~broken-set variants and
 * niche cosmetics; without this, every render of a known-broken icon kicks off
 * a fresh network round-trip just to fire the same onError again.
 *
 * Scope: process lifetime. We deliberately don't persist — wiki sprites do
 * get added over time, and a stale persistent denylist would mask new icons
 * showing up.
 */

const failedUrls = new Set<string>();

export function isFailedImage(url: string): boolean {
  return failedUrls.has(url);
}

export function markFailedImage(url: string): void {
  // Set.add returns the Set, but Set.has-then-add lets us log only on the
  // first failure per URL. Without this guard a systemic CDN problem (wrong
  // path, CSP block) would either be silently swallowed by onError → hidden
  // visibility (the bug we just shipped a fix for), or it would spam the
  // console once per render.
  if (!failedUrls.has(url)) {
    failedUrls.add(url);
    // eslint-disable-next-line no-console
    console.warn('[desktopscape] CDN image failed to load:', url);
  }
}
