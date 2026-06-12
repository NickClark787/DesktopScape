/** Parse a player-style gp amount: "100m" → 100_000_000, "1.5b", "250k",
 *  plain digits (commas/spaces tolerated). Returns null when unparseable. */
export function parseGp(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[, ]/g, '');
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1;
  const gp = Math.round(n * mult);
  return gp > 0 ? gp : null;
}

/** Compact gp display: 1_234_000_000 → "1.23b", 45_200_000 → "45.20m". */
export function formatGp(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}
