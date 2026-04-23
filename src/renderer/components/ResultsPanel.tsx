import type { BestSetupCandidate, EquipmentSlot, Monster, PlayerLoadout } from '@shared/types';
import { GearGrid } from './GearGrid';
import { GearIcon } from './GearIcon';
import { MonsterIcon } from './MonsterIcon';

interface Props {
  candidate: BestSetupCandidate | null;
  /**
   * The currently equipped loadout. Drives the always-visible gear grid so
   * users can pre-build a setup before running the optimizer (or modify
   * after). When `candidate` is set, its equipment matches this — they're
   * kept in sync via `state.setEquipment` from App.
   */
  loadout: PlayerLoadout;
  /** The monster the candidate was computed against. Shown in the header so
   *  the user always sees *what* the recommended setup is for. */
  target: Monster | null;
  computing: boolean;
  /** When provided, gear-grid cells become clickable to open the picker. */
  onSlotClick?: (slot: Exclude<EquipmentSlot, '2h'>) => void;
}

function fmt(n: number, digits = 2) {
  if (!isFinite(n)) return '∞';
  return n.toFixed(digits);
}

export function ResultsPanel({ candidate, loadout, target, computing, onSlotClick }: Props) {
  if (computing) {
    return (
      <div className="panel flex-1 flex items-center justify-center p-12">
        <div className="flex items-center gap-3 text-text-dim text-sm">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Searching gear combinations…
        </div>
      </div>
    );
  }

  // Always render the grid using `loadout.equipment`. When a candidate exists,
  // its equipment was already pushed into the store via App.runOptimizer →
  // state.setEquipment, so the two stay in sync. Showing the grid even with
  // no candidate lets users build a loadout manually before pressing
  // "Find best setup" — and gives them a clickable affordance from the
  // first interaction, instead of a wall-of-text placeholder.
  const pieces = Object.values(loadout.equipment).filter(Boolean);
  const result = candidate?.result ?? null;

  return (
    <div className="panel flex-1 flex flex-col">
      <div className="panel-heading flex items-center justify-between">
        <span>{candidate ? 'Recommended setup' : 'Loadout'}</span>
        {candidate && (
          <span className="text-text-faint normal-case">{candidate.style} · {candidate.attackStyle}</span>
        )}
      </div>
      {target && (
        <div className="px-5 pt-4 flex items-center gap-3">
          <MonsterIcon monster={target} size="md" />
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-text-faint">vs target</span>
            <span className="text-sm truncate" title={target.version ? `${target.name} (${target.version})` : target.name}>
              {target.name}
              {target.version && <span className="text-text-faint"> · {target.version}</span>}
            </span>
          </div>
        </div>
      )}
      <div className="p-5 grid grid-cols-[auto_1fr] gap-6">
        <GearGrid equipment={loadout.equipment} onSlotClick={onSlotClick} />
        {result ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="DPS" value={fmt(result.dps, 3)} primary />
              <Metric label="Max hit" value={String(result.maxHit)} />
              <Metric label="Accuracy" value={`${fmt(result.accuracy * 100, 1)}%`} />
              <Metric label="Avg TTK" value={`${fmt(result.ttkSeconds, 1)}s`} />
            </div>
            <div className="text-xs text-text-faint grid grid-cols-2 gap-y-1 gap-x-6 pt-2 border-t border-border">
              <span>Eff. attack</span><span className="text-text-dim text-right">{result.details.effectiveAttack}</span>
              <span>Eff. strength</span><span className="text-text-dim text-right">{result.details.effectiveStrength}</span>
              <span>Attack roll</span><span className="text-text-dim text-right">{result.details.attackRoll.toLocaleString()}</span>
              <span>Defence roll</span><span className="text-text-dim text-right">{result.details.defenceRoll.toLocaleString()}</span>
              <span>Weapon speed</span><span className="text-text-dim text-right">{result.weaponSpeedTicks} ticks</span>
              <span>Avg hit</span><span className="text-text-dim text-right">{fmt(result.avgHit, 2)}</span>
            </div>
          </div>
        ) : (
          // No metrics yet — coach the user toward both entry points
          // (auto-optimize OR manual click). Showing this beside the grid
          // (rather than instead of it) makes it clear the slots are live.
          <div className="flex flex-col justify-center text-sm text-text-faint">
            {target ? (
              <>
                <span>
                  Click any slot to build a loadout, or press
                  <span className="text-accent mx-1 font-semibold">Find best setup</span>
                  to auto-pick the best gear vs <span className="text-text-dim">{target.name}</span>.
                </span>
              </>
            ) : (
              <span>Pick a monster to begin. Slots become clickable as soon as a target is selected.</span>
            )}
          </div>
        )}
      </div>
      {result && result.effects.length > 0 && (
        <>
          <div className="panel-heading">Effects fired ({result.effects.length})</div>
          <div className="p-3 flex flex-col gap-1">
            {result.effects.map((e, i) => (
              <div key={i} className="text-xs flex items-baseline gap-2">
                <span className="text-accent font-medium">{e.name}</span>
                <span className="text-text-dim">{e.detail}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {pieces.length > 0 && (
        <>
          <div className="panel-heading mt-auto">Pieces ({pieces.length})</div>
          <div className="p-3 flex flex-wrap gap-2">
            {pieces.map((p) => p && (
              <span
                key={`${p.slot}-${p.id}`}
                className="text-xs px-2 py-1 rounded bg-bg-raised border border-border flex items-center gap-1.5"
              >
                <GearIcon piece={p} size="sm" />
                <span className="text-text-faint">{p.slot}:</span>
                <span>{p.name}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className={[
      'rounded-md border px-3 py-2',
      primary ? 'bg-accent/10 border-accent/50' : 'bg-bg-raised border-border',
    ].join(' ')}>
      <div className={['text-[11px] uppercase tracking-wider',
        primary ? 'text-accent' : 'text-text-faint'].join(' ')}>{label}</div>
      <div className={['font-bold text-xl mt-0.5',
        primary ? 'text-accent' : 'text-text'].join(' ')}>{value}</div>
    </div>
  );
}
