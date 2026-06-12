import type { BestSetupCandidate, CombatStyle, EquipmentSlot, Monster, PlayerLoadout } from '@shared/types';
import { GearGrid } from './GearGrid';
import { GearIcon } from './GearIcon';
import { MonsterIcon } from './MonsterIcon';
import { useCountUp } from '../hooks/useCountUp';
import { formatGp } from '../utils/gp';

// Canonical OSRS style hues — used to tint the hero block so the payoff
// number quietly reflects which combat style won.
const STYLE_COLOR: Record<CombatStyle, string> = {
  melee: '#d83a3a',
  ranged: '#3aa050',
  magic: '#5a8fce',
};

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
          <span className="text-text-faint normal-case">
            {candidate.style} · {candidate.attackStyle}
            {candidate.totalCost !== undefined && (
              <span className="text-accent/80"> · costs {formatGp(candidate.totalCost)}</span>
            )}
          </span>
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
            <HeroDps
              dps={result.dps}
              style={candidate?.style ?? loadout.style}
              attackStyle={candidate?.attackStyle ?? loadout.attackStyle}
            />
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Max hit" value={String(result.maxHit)} delay={60} />
              <Metric label="Accuracy" value={`${fmt(result.accuracy * 100, 1)}%`} delay={120} />
              <Metric label="Avg TTK" value={`${fmt(result.ttkSeconds, 1)}s`} delay={180} />
            </div>
            <div className="text-xs text-text-faint grid grid-cols-2 gap-y-1 gap-x-6 pt-3 border-t border-border animate-fade-rise" style={{ animationDelay: '240ms' }}>
              <span>Eff. attack</span><span className="text-text-dim text-right tabular-nums">{result.details.effectiveAttack}</span>
              <span>Eff. strength</span><span className="text-text-dim text-right tabular-nums">{result.details.effectiveStrength}</span>
              <span>Attack roll</span><span className="text-text-dim text-right tabular-nums">{result.details.attackRoll.toLocaleString()}</span>
              <span>Defence roll</span><span className="text-text-dim text-right tabular-nums">{result.details.defenceRoll.toLocaleString()}</span>
              <span>Weapon speed</span><span className="text-text-dim text-right tabular-nums">{result.weaponSpeedTicks} ticks</span>
              <span>Avg hit</span><span className="text-text-dim text-right tabular-nums">{fmt(result.avgHit, 2)}</span>
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
              <div
                key={i}
                className="text-xs flex items-baseline gap-2 animate-fade-rise"
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                <span className="mt-1 w-1 h-1 rounded-full bg-accent/70 shrink-0 self-center" aria-hidden />
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

/**
 * The payoff readout. A brushed-gold DPS number (see .hero-dps) that counts
 * up on first reveal and glides between values when you flip styles or swap a
 * piece. The block is tinted by the winning combat style and carries a soft
 * style-colored glow in the top-left corner for depth.
 */
function HeroDps({ dps, style, attackStyle }: { dps: number; style: CombatStyle; attackStyle: string }) {
  const shown = useCountUp(dps);
  const color = STYLE_COLOR[style];
  return (
    <div
      className="relative overflow-hidden rounded-lg border p-4 animate-fade-rise"
      style={{
        borderColor: `${color}55`,
        background: `radial-gradient(130% 150% at 0% 0%, ${color}1f, rgba(46,34,24,0.35) 60%)`,
      }}
    >
      {/* Style-colored accent rail down the left edge. */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} aria-hidden />
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.2em] text-accent/80 font-semibold">Damage / second</div>
          <div className="hero-dps text-[3.1rem]">{fmt(shown, 3)}</div>
        </div>
        <span
          className="shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full border"
          style={{ color, borderColor: `${color}66`, background: `${color}14` }}
        >
          {style} · {attackStyle}
        </span>
      </div>
    </div>
  );
}

function Metric({ label, value, delay = 0 }: { label: string; value: string; delay?: number }) {
  return (
    <div
      className="rounded-md border border-border bg-bg-raised px-3 py-2 animate-fade-rise"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="text-[11px] uppercase tracking-wider text-text-faint">{label}</div>
      <div className="font-bold text-xl mt-0.5 text-text tabular-nums">{value}</div>
    </div>
  );
}
