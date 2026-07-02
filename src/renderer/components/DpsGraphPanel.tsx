import { useMemo } from 'react';
import type { Monster, PlayerLoadout } from '@shared/types';
import { calcDps } from '../../engine/formulas';
import { applyRaidScaling } from '../../engine/raidScaling';
import { applyDefenceReduction } from '../../engine/defenceReduction';

interface Props {
  loadout: PlayerLoadout;
  target: Monster | null;
}

const W = 600;
const H = 200;
const PAD = { left: 44, right: 16, top: 14, bottom: 26 };

/**
 * DPS as a function of the target's Defence level, for the current loadout —
 * from fully drained (0) up to the (raid-scaled) base. The live point shows
 * where the configured defence-reduction opener lands, so players can see
 * exactly what each spec hit is worth and when to stop speccing.
 *
 * Hand-rolled SVG: ~40 calcDps samples, no charting dependency.
 */
export function DpsGraphPanel({ loadout, target }: Props) {
  const data = useMemo(() => {
    if (!target) return null;
    // Pre-scale once and strip raidScaling/defenceReduction from the probe
    // loadout so calcDps doesn't re-apply either while we sweep def manually.
    const scaled = applyRaidScaling(target, loadout.raidScaling);
    const probe: PlayerLoadout = { ...loadout, raidScaling: undefined, defenceReduction: undefined };
    const baseDef = scaled.skills.def;
    if (baseDef <= 0) return null;

    const samples = Math.min(40, baseDef);
    const points: Array<{ def: number; dps: number }> = [];
    for (let i = 0; i <= samples; i++) {
      const def = Math.round((baseDef * i) / samples);
      const m: Monster = { ...scaled, skills: { ...scaled.skills, def } };
      points.push({ def, dps: calcDps(probe, m).dps });
    }

    const currentDef = applyDefenceReduction(scaled, loadout.defenceReduction).skills.def;
    const currentDps = calcDps(probe, { ...scaled, skills: { ...scaled.skills, def: currentDef } }).dps;
    const maxDps = Math.max(...points.map((p) => p.dps), currentDps);
    return { points, baseDef, currentDef, currentDps, maxDps, reduced: currentDef !== baseDef };
  }, [loadout, target]);

  if (!target || !data || data.maxDps <= 0) return null;

  const { points, baseDef, currentDef, currentDps, maxDps } = data;
  const x = (def: number) => PAD.left + ((W - PAD.left - PAD.right) * def) / baseDef;
  const y = (dps: number) => H - PAD.bottom - ((H - PAD.top - PAD.bottom) * dps) / (maxDps * 1.06);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.def).toFixed(1)},${y(p.dps).toFixed(1)}`).join(' ');
  // Area fill under the line for a little depth.
  const area = `${path} L${x(baseDef).toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`;
  const gridYs = [0.25, 0.5, 0.75].map((f) => y(maxDps * f));
  const flatLine = points[0].dps - points[points.length - 1].dps < 0.005;

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>DPS vs target defence</span>
        <span className="panel-heading-meta tabular-nums">
          at def {currentDef}: {currentDps.toFixed(2)} dps
        </span>
      </div>
      <div className="p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
          aria-label={`DPS against ${target.name} from defence 0 to ${baseDef}`}>
          {/* grid */}
          {gridYs.map((gy, i) => (
            <line key={i} x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy}
              stroke="#4a3a26" strokeWidth="1" strokeDasharray="3 5" opacity="0.5" />
          ))}
          {/* axes */}
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="#6b5538" strokeWidth="1" />
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="#6b5538" strokeWidth="1" />
          {/* area + line */}
          <path d={area} fill="rgba(255,203,71,0.07)" />
          <path d={path} fill="none" stroke="#ffcb47" strokeWidth="2" strokeLinejoin="round" />
          {/* current (post-opener) defence marker */}
          <line x1={x(currentDef)} x2={x(currentDef)} y1={PAD.top} y2={H - PAD.bottom}
            stroke="#d83a3a" strokeWidth="1" strokeDasharray="4 4" opacity="0.8" />
          <circle cx={x(currentDef)} cy={y(currentDps)} r="4" fill="#ffe080" stroke="#1a130d" strokeWidth="1.5" />
          {/* labels */}
          <text x={PAD.left - 6} y={y(maxDps) + 4} textAnchor="end" fontSize="10" fill="#b8a484" className="tabular-nums">{maxDps.toFixed(1)}</text>
          <text x={PAD.left - 6} y={H - PAD.bottom + 4} textAnchor="end" fontSize="10" fill="#b8a484">0</text>
          <text x={PAD.left} y={H - PAD.bottom + 16} textAnchor="middle" fontSize="10" fill="#b8a484">0</text>
          <text x={W - PAD.right} y={H - PAD.bottom + 16} textAnchor="end" fontSize="10" fill="#b8a484" className="tabular-nums">def {baseDef}</text>
          <text x={Math.min(x(currentDef) + 6, W - 70)} y={PAD.top + 10} fontSize="10" fill="#d83a3a">after opener</text>
        </svg>
        {flatLine && (
          <p className="text-[11px] text-text-faint mt-1 leading-snug">
            {loadout.style === 'magic'
              ? 'Magic accuracy rolls against the Magic level, not Defence — draining Defence does not help this setup (Accursed sceptre lowers Magic too).'
              : 'DPS is flat across this defence range for the current setup.'}
          </p>
        )}
      </div>
    </div>
  );
}
