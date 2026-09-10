import { useEffect, useRef, useState } from 'react';
import type { BestSetupCandidate, CombatStyle, EquipmentSlot, Monster, PlayerLoadout } from '@shared/types';
import { GearGrid } from './GearGrid';
import { MonsterIcon } from './MonsterIcon';
import { EquipmentTotals } from './EquipmentTotals';
import { StatOrb } from './StatOrb';
import { useCountUp } from '../hooks/useCountUp';
import { formatGp } from '../utils/gp';

// Canonical OSRS style hues — used to tint the hero block so the payoff
// number quietly reflects which combat style won. Mirrors the style.* tokens.
const STYLE_COLOR: Record<CombatStyle, string> = {
  melee: '#e2402a',
  ranged: '#3fbf5f',
  magic: '#4a90e2',
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

interface Drop { id: number; text: string; up: boolean }

/**
 * XP-drop machinery: watches a numeric value and emits a floating delta
 * (OSRS-style) whenever it changes. Each drop unmounts on animationend, so
 * under prefers-reduced-motion (where the animation collapses to ~0ms) drops
 * vanish immediately. Concurrency is capped at two.
 */
function useXpDrops(value: number, format: (delta: number) => string) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const prev = useRef<number | null>(null);
  const nextId = useRef(0);
  useEffect(() => {
    const last = prev.current;
    prev.current = value;
    if (last === null || !isFinite(value) || !isFinite(last)) return;
    const delta = value - last;
    if (Math.abs(delta) < 0.005) return;
    const id = ++nextId.current;
    setDrops((d) => [...d.slice(-1), { id, text: format(delta), up: delta > 0 }]);
  }, [value, format]);
  const remove = (id: number) => setDrops((d) => d.filter((x) => x.id !== id));
  return { drops, remove };
}

function XpDrops({ drops, remove }: { drops: Drop[]; remove: (id: number) => void }) {
  return (
    <>
      {drops.map((d) => (
        <span
          key={d.id}
          onAnimationEnd={() => remove(d.id)}
          className={['xp-drop right-1 top-1', d.up ? 'text-osrs-yellow' : 'text-osrs-red'].join(' ')}
          aria-hidden
        >
          {d.text}
        </span>
      ))}
    </>
  );
}

export function ResultsPanel({ candidate, loadout, target, computing, onSlotClick }: Props) {
  // Gold shimmer flourish: fires once whenever a new candidate resolves
  // (optimizer run or applied swap). The band unmounts on animationend so
  // its will-change never lingers.
  const [shimmer, setShimmer] = useState(false);
  const candidateRef = useRef<BestSetupCandidate | null>(null);
  useEffect(() => {
    if (candidate && candidate !== candidateRef.current) setShimmer(true);
    candidateRef.current = candidate;
  }, [candidate]);

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
  // state.setEquipment, so the two stay in sync.
  const result = candidate?.result ?? null;
  // The style whose offence/defence axis the totals table highlights. Mirrors
  // the hero block, so the table calls out the same style the payoff number does.
  const activeStyle = candidate?.style ?? loadout.style;

  return (
    <div className="panel flex-1 flex flex-col">
      <div className="panel-heading flex items-center justify-between">
        <span>{candidate ? 'Recommended setup' : 'Loadout'}</span>
        {candidate && (
          <span className="panel-heading-meta">
            {candidate.style} · {candidate.attackStyle}
            {candidate.totalCost !== undefined && (
              <span className="font-semibold"> · costs {formatGp(candidate.totalCost)}</span>
            )}
          </span>
        )}
      </div>
      {target && (
        <div className="px-5 pt-4 flex items-center gap-3">
          <MonsterIcon monster={target} size="md" />
          <div className="flex flex-col min-w-0">
            <span className="font-pixel text-[11px] uppercase tracking-wider text-text-faint">vs target</span>
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
              shimmer={shimmer}
              onShimmerEnd={() => setShimmer(false)}
            />
            <div className="grid grid-cols-3 gap-3 items-center">
              <MaxHitScroll value={result.maxHit} />
              <StatOrb
                label="Accuracy"
                display={`${Math.round(result.accuracy * 100)}%`}
                frac={result.accuracy}
                color="var(--c-cyan)"
                title={`Chance to land a hit: ${fmt(result.accuracy * 100, 1)}%`}
              />
              <StatOrb
                label="Avg TTK"
                display={`${isFinite(result.ttkSeconds) ? Math.round(result.ttkSeconds) + 's' : '∞'}`}
                frac={isFinite(result.ttkSeconds) ? 1 - Math.min(1, result.ttkSeconds / 180) : 0}
                color="var(--c-xp-green)"
                title={`Average time to kill: ${fmt(result.ttkSeconds, 1)}s (fuller orb = faster kill)`}
                bob
              />
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
          <div className="flex flex-col justify-center text-sm text-text-faint">
            {target ? (
              <span>
                Click any slot to build a loadout, or press
                <span className="text-accent mx-1 font-semibold">Find best setup</span>
                to auto-pick the best gear vs <span className="text-text-dim">{target.name}</span>.
              </span>
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
      <EquipmentTotals equipment={loadout.equipment} activeStyle={activeStyle} />
    </div>
  );
}

/**
 * The payoff readout: struck-gold DPS numerals on a style-tinted stone slab.
 * Counts up on reveal, glides between values, floats an OSRS XP-drop when
 * the number changes, and sweeps a one-shot gold shimmer whenever a new
 * best setup resolves.
 */
function HeroDps({ dps, style, attackStyle, shimmer, onShimmerEnd }: {
  dps: number;
  style: CombatStyle;
  attackStyle: string;
  shimmer: boolean;
  onShimmerEnd: () => void;
}) {
  const shown = useCountUp(dps);
  const { drops, remove } = useXpDrops(dps, (d) => `${d > 0 ? '+' : ''}${fmt(d, 2)}`);
  const color = STYLE_COLOR[style];
  return (
    <div
      className="relative overflow-hidden rounded-lg border p-4 animate-fade-rise"
      style={{
        borderColor: `${color}55`,
        background: `radial-gradient(130% 150% at 0% 0%, ${color}1f, rgba(43,36,25,0.4) 60%)`,
      }}
    >
      {shimmer && <span className="shimmer-band left-0" onAnimationEnd={onShimmerEnd} aria-hidden />}
      <XpDrops drops={drops} remove={remove} />
      {/* Style-colored accent rail down the left edge. */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} aria-hidden />
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <div className="font-pixel text-[11px] uppercase tracking-[0.18em] text-accent/90">Damage / second</div>
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

/** Max-hit on a small parchment scroll card, with its own XP-drop. */
function MaxHitScroll({ value }: { value: number }) {
  const { drops, remove } = useXpDrops(value, (d) => `${d > 0 ? '+' : ''}${Math.round(d)}`);
  return (
    <div className="parchment-card relative px-3 py-2">
      <XpDrops drops={drops} remove={remove} />
      <div className="text-[11px] uppercase tracking-wider text-parchment-ink-dim font-semibold">Max hit</div>
      <div className="font-display font-bold text-2xl mt-0.5 text-parchment-ink tabular-nums">{value}</div>
    </div>
  );
}
