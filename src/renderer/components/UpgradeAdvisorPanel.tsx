import { useEffect, useMemo, useState } from 'react';
import type { BestSetupCandidate, CombatStyle, Monster, PlayerLoadout } from '@shared/types';
import { findUpgrades, type UpgradeSuggestion } from '../../engine/upgradeAdvisor';
import { GearIcon } from './GearIcon';

type Scope = 'owned' | 'all';
type SortBy = 'dps' | 'value';

interface Props {
  loadout: PlayerLoadout;
  target: Monster | null;
  style: CombatStyle;
  ownedIds: Set<number>;
  /** Estimated GE price per item id, or null until fetched. */
  prices: Map<number, number> | null;
  pricesUpdatedAt: number | null;
  loadingPrices: boolean;
  onFetchPrices: () => Promise<void>;
  /** Runs the optimizer for the current style at the given scope. */
  onOptimize: (scope: Scope) => BestSetupCandidate | null;
  /** Applies an upgrade's gear changes + stance/attack/spell hints. */
  onApply: (sug: UpgradeSuggestion) => void;
}

const SLOT_LABEL: Record<string, string> = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo', weapon: 'Weapon',
  body: 'Body', shield: 'Shield', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
};

const fmt = (n: number, d = 2) => (isFinite(n) ? n.toFixed(d) : '∞');

function fmtGp(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

function ago(ts: number): string {
  const s = Math.max(0, Date.now() - ts) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

interface Row {
  s: UpgradeSuggestion;
  price: number | null;
  /** DPS gained per 1M gp (owned items are free → Infinity). null = no price. */
  value: number | null;
}

export function UpgradeAdvisorPanel({
  loadout, target, style, ownedIds, prices, pricesUpdatedAt, loadingPrices, onFetchPrices, onOptimize, onApply,
}: Props) {
  const [scope, setScope] = useState<Scope>(() => (ownedIds.size > 0 ? 'owned' : 'all'));
  const [sortBy, setSortBy] = useState<SortBy>('dps');
  const [best, setBest] = useState<BestSetupCandidate | null>(null);
  const [computing, setComputing] = useState(false);
  const [priceError, setPriceError] = useState('');

  // The cached optimum is specific to the target + style AND everything that
  // feeds the DPS calc except gear: skills, prayers, potions, slayer/wildy
  // flags, raid scaling and defence reduction. Invalidate on any of those so
  // we never diff the live loadout against an optimum computed under old
  // buffs. Gear/stance/spell edits intentionally KEEP the cache — that's the
  // "list shrinks live as you apply suggestions" behavior.
  useEffect(() => { setBest(null); }, [
    target?.id, target?.version, style,
    loadout.skills, loadout.prayers, loadout.potions,
    loadout.onSlayerTask, loadout.inWilderness,
    loadout.raidScaling, loadout.defenceReduction,
  ]);

  // Cheap marginal diff — recomputes as the loadout changes (e.g. after the
  // player applies a suggestion), so the list shrinks live without re-optimizing.
  const report = useMemo(() => {
    if (!best || !target) return null;
    return findUpgrades(loadout, target, best, ownedIds.size ? ownedIds : null);
  }, [best, target, loadout, ownedIds]);

  // Attach price + value, then order by the chosen key.
  const rows: Row[] = useMemo(() => {
    if (!report) return [];
    const withPrice: Row[] = report.suggestions.map((s) => {
      const price = s.owned ? null : (prices?.get(s.to.id) ?? null);
      const value = s.owned ? Infinity : (price && price > 0 ? (s.delta * 1e6) / price : null);
      return { s, price, value };
    });
    if (sortBy === 'value' && prices) {
      // Free (owned) upgrades first, then best DPS-per-gp, unknown prices last.
      return withPrice.slice().sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    }
    return withPrice; // already DPS-desc from the engine
  }, [report, prices, sortBy]);

  function run(s: Scope) {
    if (!target) return;
    setScope(s);
    setComputing(true);
    requestAnimationFrame(() => {
      setBest(onOptimize(s));
      setComputing(false);
    });
  }

  async function loadPrices() {
    setPriceError('');
    try {
      await onFetchPrices();
      setSortBy('value');
    } catch (e) {
      setPriceError(`Couldn't fetch prices: ${(e as Error).message}`);
    }
  }

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Upgrade advisor</span>
        {report && !report.atOptimum && (
          <span className="panel-heading-meta">{report.suggestions.length} found</span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Scope + run */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-bg-soft p-1 text-sm">
            <button className="pill-tab" data-active={scope === 'owned'} onClick={() => run('owned')}
              disabled={!target || ownedIds.size === 0}
              title={ownedIds.size === 0
                ? 'Add owned items first (Owned-only filter panel) — an empty bank has nothing to suggest'
                : 'Best upgrades you can equip from your owned items'}>From my bank</button>
            <button className="pill-tab" data-active={scope === 'all'} onClick={() => run('all')} disabled={!target}
              title="Best upgrades from every item — buy targets included">All items</button>
          </div>
          <button className="btn btn-primary text-sm" onClick={() => run(scope)} disabled={!target || computing}>
            {computing ? 'Searching…' : best ? 'Recompute' : 'Find upgrades'}
          </button>
        </div>

        {/* Summary + price/sort controls */}
        {report && (
          <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-2 text-text-dim tabular-nums">
              <span>Current <span className="text-text">{fmt(report.baseline, 2)}</span></span>
              <span className="text-text-faint">→</span>
              <span>Best <span className="text-accent font-semibold">{fmt(report.bestDps, 2)}</span> dps</span>
              {report.bestDps - report.baseline > 0.005 && (
                <span className="text-osrs-green">(+{fmt(report.bestDps - report.baseline, 2)})</span>
              )}
            </div>
            {!report.atOptimum && (
              <div className="flex items-center gap-2">
                <span className="text-text-faint">Sort</span>
                <div className="inline-flex rounded border border-border bg-bg-soft p-0.5">
                  <button className="pill-tab !px-2 !py-0.5 text-xs" data-active={sortBy === 'dps'} onClick={() => setSortBy('dps')}>DPS</button>
                  <button
                    className="pill-tab !px-2 !py-0.5 text-xs"
                    data-active={sortBy === 'value'}
                    onClick={() => (prices ? setSortBy('value') : loadPrices())}
                    title="DPS gained per GP"
                  >Value</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Prices status line */}
        {report && !report.atOptimum && (
          <div className="text-[11px] text-text-faint flex items-center gap-2">
            {loadingPrices ? (
              <span>Fetching live GE prices…</span>
            ) : prices ? (
              <>
                <span>GE prices · {pricesUpdatedAt ? ago(pricesUpdatedAt) : 'loaded'}</span>
                <button className="hover:text-accent underline-offset-2 hover:underline" onClick={loadPrices}>refresh</button>
              </>
            ) : (
              <button className="hover:text-accent underline-offset-2 hover:underline" onClick={loadPrices}>
                Load live GE prices to rank by value (DPS per GP)
              </button>
            )}
            {priceError && <span className="text-style-melee">{priceError}</span>}
          </div>
        )}

        {/* Body states */}
        {!target ? (
          <p className="text-sm text-text-faint">Pick a monster to find upgrades for your current setup.</p>
        ) : !report ? (
          <p className="text-sm text-text-faint">
            Build or load a setup, then find the highest-DPS swaps toward the best gear
            {scope === 'owned' ? ' you own' : ''}. Each suggestion is one click to equip.
          </p>
        ) : report.atOptimum ? (
          <p className="text-sm text-text-dim">
            Your setup is already optimal vs <span className="text-text">{target.name}</span>
            {scope === 'owned' ? ' for the items you own' : ''}. Nothing to upgrade. 🏆
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {rows.map(({ s, price, value }, i) => (
              <button
                key={`${s.slot}-${s.to.id}`}
                onClick={() => onApply(s)}
                title={`Equip ${s.to.name}${s.to.version ? ` (${s.to.version})` : ''}`}
                className="group flex items-center gap-3 rounded-md border border-border bg-bg-raised px-3 py-2 text-left
                           transition-[transform,border-color] duration-150 ease-out
                           hover:border-accent-carved hover:shadow-glow hover:-translate-y-px animate-fade-rise"
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                <GearIcon piece={s.to} size="md" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-text-faint w-12 shrink-0">{SLOT_LABEL[s.slot] ?? s.slot}</span>
                    <span className="truncate text-sm">
                      {s.to.name}
                      {s.to.version && <span className="text-text-faint"> · {s.to.version}</span>}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-text-faint pl-14">
                    <span className="truncate">{s.from ? `replaces ${s.from.name}` : 'empty slot'}</span>
                  </span>
                </span>
                <span className="flex flex-col items-end shrink-0 tabular-nums">
                  <span className="text-osrs-green text-sm font-semibold">
                    +{fmt(s.delta, 2)}
                    {s.pct !== null && <span className="text-osrs-green/70 text-[11px] font-normal"> ({fmt(s.pct * 100, 0)}%)</span>}
                  </span>
                  {s.owned ? (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-style-ranged">Owned</span>
                  ) : (
                    <span className="text-[11px] flex items-center gap-1">
                      <span className="uppercase tracking-wider font-bold text-accent">Buy</span>
                      {price != null && <span className="text-text-dim">{fmtGp(price)}</span>}
                      {value != null && isFinite(value) && <span className="text-text-faint">· {fmt(value, 2)} dps/m</span>}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
