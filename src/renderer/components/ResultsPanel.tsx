import type { BestSetupCandidate, EquipmentSlot, Monster } from '@shared/types';
import { GearGrid } from './GearGrid';
import { GearIcon } from './GearIcon';
import { MonsterIcon } from './MonsterIcon';

interface Props {
  candidate: BestSetupCandidate | null;
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

export function ResultsPanel({ candidate, target, computing, onSlotClick }: Props) {
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
  if (!candidate) {
    return (
      <div className="panel flex-1 flex items-center justify-center p-12 text-text-faint text-sm">
        Pick a monster and press <span className="text-accent mx-1 font-semibold">Find best setup</span>.
      </div>
    );
  }

  const { result, equipment, style, attackStyle } = candidate;
  const pieces = Object.values(equipment).filter(Boolean);

  return (
    <div className="panel flex-1 flex flex-col">
      <div className="panel-heading flex items-center justify-between">
        <span>Recommended setup</span>
        <span className="text-text-faint normal-case">{style} · {attackStyle}</span>
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
        <GearGrid equipment={equipment} onSlotClick={onSlotClick} />
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
      </div>
      {result.effects.length > 0 && (
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
