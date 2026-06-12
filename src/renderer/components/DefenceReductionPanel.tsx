import type { DefenceReduction, Monster } from '@shared/types';
import { applyDefenceReduction, defenceFloor } from '../../engine/defenceReduction';

interface Props {
  value: DefenceReduction | undefined;
  monster: Monster | null;
  onChange: (v: DefenceReduction | undefined) => void;
}

const ZERO: DefenceReduction = {
  dwh: 0, elderMaul: 0, arclight: 0, emberlight: 0, bgs: 0, accursed: false, vulnerability: false,
};

const isZero = (r: DefenceReduction): boolean =>
  !(r.dwh || r.elderMaul || r.arclight || r.emberlight || r.bgs || r.accursed || r.vulnerability);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

type HitKey = 'dwh' | 'elderMaul' | 'arclight' | 'emberlight' | 'bgs';

export function DefenceReductionPanel({ value, monster, onChange }: Props) {
  const r = value ?? ZERO;
  const active = !isZero(r);

  const set = (patch: Partial<DefenceReduction>) => {
    const next = { ...r, ...patch };
    onChange(isZero(next) ? undefined : next);
  };

  const baseDef = monster?.skills.def ?? null;
  const reducedDef = monster ? applyDefenceReduction(monster, active ? r : undefined).skills.def : null;
  const pctOff = baseDef && reducedDef !== null && baseDef > 0
    ? Math.round((1 - reducedDef / baseDef) * 100)
    : 0;

  const numField = (label: string, key: HitKey, max: number, hint?: string) => (
    <label className="flex items-center justify-between gap-2 text-sm" title={hint}>
      <span className="text-text-dim truncate">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={r[key] || ''}
        placeholder="0"
        onChange={(e) => set({ [key]: clamp(Math.floor(Number(e.target.value) || 0), 0, max) } as Partial<DefenceReduction>)}
        className="num-input w-14"
      />
    </label>
  );

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Defence reduction</span>
        {active && <button className="text-text-faint normal-case hover:text-accent" onClick={() => onChange(undefined)}>clear</button>}
      </div>
      <div className="p-3 flex flex-col gap-3">
        {/* Effective-defence readout */}
        {monster ? (
          <div className="text-xs text-text-dim tabular-nums flex items-center gap-2 flex-wrap">
            <span>Target def</span>
            <span className="text-text">{baseDef}</span>
            {active && (
              <>
                <span className="text-text-faint">→</span>
                <span className="text-accent font-semibold">{reducedDef}</span>
                <span className="text-emerald-400">(−{pctOff}%)</span>
              </>
            )}
            {(() => {
              const floor = defenceFloor(monster);
              if (floor <= 0) return null;
              return floor >= (baseDef ?? 0) ? (
                <span className="text-amber-400">immune to def drain</span>
              ) : (
                <span className="text-text-faint">floor {floor}</span>
              );
            })()}
          </div>
        ) : (
          <p className="text-xs text-text-faint">Pick a monster to see its reduced defence.</p>
        )}

        {/* Opener spec hits */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {numField('Dragon warhammer', 'dwh', 20, 'Each hit removes 30% of current Defence')}
          {numField('Elder maul', 'elderMaul', 20, 'Each hit removes 35% of current Defence')}
          {numField('Arclight', 'arclight', 20, 'Flat per-hit drain off base Defence (2× vs demons)')}
          {numField('Emberlight', 'emberlight', 20, 'Flat per-hit drain off base Defence (3× vs demons)')}
          {numField('Bandos GS −lvls', 'bgs', 999, 'Defence levels drained by BGS spec damage')}
        </div>

        {/* Flag effects */}
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-text" title="−15% Defence and Magic level">
            <input type="checkbox" checked={r.accursed} onChange={(e) => set({ accursed: e.target.checked })} className="accent-accent" />
            <span>Accursed sceptre</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-text" title="−10% Defence level">
            <input type="checkbox" checked={r.vulnerability} onChange={(e) => set({ vulnerability: e.target.checked })} className="accent-accent" />
            <span>Vulnerability</span>
          </label>
        </div>

        <p className="text-[11px] text-text-faint leading-snug">
          Simulates an opener: drains the target's Defence so melee/ranged accuracy reflects the
          real fight. Magic accuracy uses the Magic level (only Accursed lowers it).
        </p>
      </div>
    </div>
  );
}
