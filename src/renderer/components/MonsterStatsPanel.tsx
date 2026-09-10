import type { CombatStyle, Monster } from '@shared/types';
import { MonsterIcon } from './MonsterIcon';

interface Props {
  monster: Monster | null;
  /** Highlights the defence row matching the user's currently-selected style.
   *  Lets the player see at a glance how punishing their chosen style is on
   *  this target before they even hit Find best setup. */
  activeStyle?: CombatStyle;
}

function s(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Color-code a defence value by how punishing it is — green=exploitable
 *  through gold=tough up to red=brick wall. The thresholds are eyeballed from
 *  typical monster-data ranges: 0/low for trash mobs, 100+ for raid bosses,
 *  200+ for the few extreme defenders (e.g. ToA Wardens magic def). */
function defColor(v: number): string {
  if (v <= 0) return 'text-style-ranged';
  if (v < 50) return 'text-text-dim';
  if (v < 100) return 'text-text';
  if (v < 200) return 'text-accent';
  return 'text-style-melee font-bold';
}

export function MonsterStatsPanel({ monster, activeStyle }: Props) {
  if (!monster) {
    return (
      <div className="panel">
        <div className="panel-heading">Target stats</div>
        <div className="px-3 py-4 text-xs text-text-faint">
          Pick a monster to see its combat stats.
        </div>
      </div>
    );
  }

  const def = monster.defensive;
  const sk = monster.skills;

  // Defence rows in the same order as the in-game Combat tab — three melee
  // styles, then magic, then ranged. The data calls ranged defence
  // 'standard' (heavy/standard/light are bolt/arrow/dart subtypes; standard
  // is the canonical roll for most ranged weapons).
  const defRows: Array<{ label: string; value: number; style: CombatStyle }> = [
    { label: 'Stab', value: def.stab, style: 'melee' },
    { label: 'Slash', value: def.slash, style: 'melee' },
    { label: 'Crush', value: def.crush, style: 'melee' },
    { label: 'Magic', value: def.magic, style: 'magic' },
    { label: 'Ranged', value: def.standard, style: 'ranged' },
  ];

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between gap-2">
        <span>Target stats</span>
        {monster.is_slayer_monster && (
          <span className="text-text-faint normal-case text-[10px]">slayer-only</span>
        )}
      </div>
      <div className="p-3 flex items-start gap-3">
        <div className="w-12 h-12 shrink-0 bg-bg-slot rounded border border-border shadow-slot flex items-center justify-center">
          <MonsterIcon monster={monster} size="lg" />
        </div>
        <div className="flex flex-col min-w-0 gap-1 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate" title={monster.name}>{monster.name}</span>
            {monster.version && (
              <span className="text-text-faint text-xs truncate" title={monster.version}>{monster.version}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            <Stat label="Lvl" value={monster.level} />
            <Stat label="HP" value={sk.hp} />
            <Stat label="Speed" value={`${monster.speed}t`} />
            {monster.max_hit && <Stat label="Max" value={monster.max_hit} />}
          </div>
          {monster.style && monster.style.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[10px] mt-0.5">
              <span className="font-pixel text-text-faint uppercase tracking-wider">attacks</span>
              {monster.style.map((st) => (
                <span key={st} className="px-1.5 py-px rounded bg-bg-raised border border-border text-text-dim">
                  {st}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-border grid grid-cols-2">
        <div className="p-3">
          <div className="font-pixel text-[10px] uppercase tracking-wider text-text-faint mb-1.5">Combat</div>
          <div className="flex flex-col gap-0.5 text-xs">
            <Row label="Attack" value={sk.atk} />
            <Row label="Strength" value={sk.str} />
            <Row label="Magic" value={sk.magic} />
            <Row label="Ranged" value={sk.ranged} />
            <Row label="Defence" value={sk.def} />
          </div>
        </div>
        <div className="p-3 border-l border-border">
          <div className="font-pixel text-[10px] uppercase tracking-wider text-text-faint mb-1.5">Defence</div>
          <div className="flex flex-col gap-0.5 text-xs">
            {defRows.map((r) => {
              const isActive = activeStyle === r.style;
              return (
                <div
                  key={r.label}
                  className={[
                    'flex items-center justify-between gap-2 px-1 -mx-1 rounded',
                    isActive ? 'bg-accent/10' : '',
                  ].join(' ')}
                  title={isActive ? `${r.label} defence — your selected style` : r.label}
                >
                  <span className="text-text-dim">{r.label}</span>
                  <span className={['tabular-nums', defColor(r.value)].join(' ')}>{s(r.value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {(monster.weakness?.element || (monster.attributes && monster.attributes.length > 0)) && (
        <div className="border-t border-border p-3 flex flex-wrap gap-1.5 items-center">
          {monster.weakness?.element && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-style-magic/15 border border-style-magic/40 text-style-magic capitalize"
              title="Elemental weakness — bonus magic damage when matching the element."
            >
              weak: {monster.weakness.element}
              {monster.weakness.severity ? ` +${monster.weakness.severity}%` : ''}
            </span>
          )}
          {monster.attributes?.map((a) => (
            <span
              key={a}
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-raised border border-border text-text-dim capitalize"
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-pixel text-text-faint uppercase tracking-wider text-[9px]">{label}</span>
      <span className="text-text font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-dim">{label}</span>
      <span className="tabular-nums text-text">{value}</span>
    </div>
  );
}
