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
  failedUrls.add(url);
}
