import type { DataMeta } from '../../preload';

/**
 * Color-coded chip showing how old the OSRS data is. Reads file mtime from
 * `loadData().meta` — for users who've never refreshed it'll be the bundled
 * file's build-time mtime, which is "fresh" right after install but slowly
 * drifts. Once the user clicks Refresh, the mtime updates and the chip
 * resets to green.
 *
 * Thresholds (chosen empirically — Wiki updates roughly weekly during major
 * leagues, monthly otherwise):
 *   - <14 days   → green/dim, just informational
 *   - 14-60 days → amber, "consider refreshing"
 *   - >60 days   → red, "you're missing recent items/bosses"
 *
 * Bundled data older than 14 days additionally surfaces a "Bundled" tag so
 * users understand why a fresh install might still show stale data.
 */
interface Props {
  meta: DataMeta | null;
}

function ageDays(refreshedAt: number): number {
  if (!refreshedAt) return Infinity;
  return (Date.now() - refreshedAt) / (1000 * 60 * 60 * 24);
}

function ageLabel(days: number): string {
  if (!isFinite(days)) return 'unknown age';
  if (days < 1) {
    const hours = Math.max(0, Math.round(days * 24));
    if (hours < 1) return 'just now';
    return `${hours}h ago`;
  }
  if (days < 30) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function DataStalenessBadge({ meta }: Props) {
  if (!meta) return null;
  const days = ageDays(meta.refreshedAt);
  const label = ageLabel(days);
  const sourceTag = meta.source === 'bundled' ? ' · bundled' : '';

  let cls = 'text-text-faint';
  let dotCls = 'bg-text-faint/40';
  let title = `OSRS data ${label}${sourceTag === ' · bundled' ? ' (shipped with installer)' : ' (last refresh from CDN)'}`;
  if (days >= 60) {
    cls = 'text-red-400';
    dotCls = 'bg-red-400';
    title = `OSRS data is ${label} — likely missing recent items/bosses. Click Refresh.`;
  } else if (days >= 14) {
    cls = 'text-yellow-400';
    dotCls = 'bg-yellow-400';
    title = `OSRS data is ${label}${sourceTag === ' · bundled' ? ' (shipped with installer)' : ''} — consider refreshing.`;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${cls}`}
      title={title}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
      Data {label}{sourceTag}
    </span>
  );
}
