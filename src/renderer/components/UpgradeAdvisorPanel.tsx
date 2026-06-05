import { useEffect, useMemo, useState } from 'react';
import type { BestSetupCandidate, CombatStyle, Monster, PlayerLoadout } from '@shared/types';
import { findUpgrades, type UpgradeSuggestion } from '../../engine/upgradeAdvisor';
import { GearIcon } from './GearIcon';

type Scope = 'owned' | 'all';

interface Props {
  loadout: PlayerLoadout;
  target: Monster | null;
  style: CombatStyle;
  ownedIds: Set<number>;
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

export function UpgradeAdvisorPanel({ loadout, target, style, ownedIds, onOptimize, onApply }: Props) {
  const [scope, setScope] = useState<Scope>(() => (ownedIds.size > 0 ? 'owned' : 'all'));
  const [best, setBest] = useState<BestSetupCandidate | null>(null);
  const [computing, setComputing] = useState(false);

  // The cached optimum is specific to this target + style + scope. Invalidate
  // it when any of those change so we don't diff against a stale optimum.
  useEffect(() => { setBest(null); }, [target?.id, target?.version, style]);

  // Cheap marginal diff — recomputes as the loadout changes (e.g. after the
  // player applies a suggestion), so the list shrinks live without re-optimizing.
  const report = useMemo(() => {
    if (!best || !target) return null;
    return findUpgrades(loadout, target, best, ownedIds.size ? ownedIds : null);
  }, [best, target, loadout, ownedIds]);

  function run(s: Scope) {
    if (!target) return;
    setScope(s);
    setComputing(true);
    // Yield a frame so the spinner paints before the (sync) optimizer runs.
    requestAnimationFrame(() => {
      setBest(onOptimize(s));
      setComputing(false);
    });
  }

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Upgrade advisor</span>
        {report && !report.atOptimum && (
          <span className="text-text-faint normal-case">{report.suggestions.length} found</span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Scope toggle */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-border bg-bg-soft p-1 text-sm">
            <button
              className="pill-tab"
              data-active={scope === 'owned'}
              onClick={() => run('owned')}
              disabled={!target}
              title="Best upgrades you can equip from your owned items"
            >
              From my bank
            </button>
            <button
              className="pill-tab"
              data-active={scope === 'all'}
              onClick={() => run('all')}
              disabled={!target}
              title="Best upgrades from every item — buy targets included"
            >
              All items
            </button>
          </div>
          <button
            className="btn btn-primary text-sm"
            onClick={() => run(scope)}
            disabled={!target || computing}
          >
            {computing ? 'Searching…' : best ? 'Recompute' : 'Find upgrades'}
          </button>
        </div>

        {/* Summary bar: current → best */}
        {report && (
          <div className="flex items-center gap-2 text-xs text-text-dim tabular-nums">
            <span>Current <span className="text-text">{fmt(report.baseline, 2)}</span></span>
            <span className="text-text-faint">→</span>
            <span>Best <span className="text-accent font-semibold">{fmt(report.bestDps, 2)}</span> dps</span>
            {report.bestDps - report.baseline > 0.005 && (
              <span className="text-emerald-400">(+{fmt(report.bestDps - report.baseline, 2)})</span>
            )}
            <span className="text-text-faint">· {scope === 'owned' ? 'your bank' : 'all items'}</span>
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
            {report.suggestions.map((s, i) => (
              <button
                key={`${s.slot}-${s.to.id}`}
                onClick={() => onApply(s)}
                title={`Equip ${s.to.name}${s.to.version ? ` (${s.to.version})` : ''}`}
                className="group flex items-center gap-3 rounded-md border border-border bg-bg-raised px-3 py-2 text-left
                           transition-[transform,border-color,box-shadow] duration-150 ease-out
                           hover:border-accent/70 hover:shadow-glow hover:-translate-y-px animate-fade-rise"
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
                  <span className="text-emerald-400 text-sm font-semibold">
                    +{fmt(s.delta, 2)}
                    {s.pct !== null && <span className="text-emerald-400/70 text-[11px] font-normal"> ({fmt(s.pct * 100, 0)}%)</span>}
                  </span>
                  <span
                    className={[
                      'text-[10px] uppercase tracking-wider font-bold',
                      s.owned ? 'text-style-ranged' : 'text-accent',
                    ].join(' ')}
                  >
                    {s.owned ? 'Owned' : 'Buy'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
