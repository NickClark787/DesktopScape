import type { CombatStyle, PlayerLoadout } from '@shared/types';

interface Props {
  equipment: PlayerLoadout['equipment'];
  /** Highlights the column matching the user's currently-selected style so
   *  the player sees at a glance which offence/defence axis their loadout
   *  is actually leveraging. */
  activeStyle?: CombatStyle;
}

interface Totals {
  off: { stab: number; slash: number; crush: number; magic: number; ranged: number };
  defn: { stab: number; slash: number; crush: number; magic: number; ranged: number };
  str: number;
  ranged_str: number;
  magic_str: number;
  prayer: number;
  weight: number;
}

function emptyTotals(): Totals {
  return {
    off: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defn: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    str: 0,
    ranged_str: 0,
    magic_str: 0,
    prayer: 0,
    weight: 0,
  };
}

/** Sum every equipped piece's stats — equivalent to the in-game Equipment
 *  Stats interface. Empty slots contribute zero. */
function sumEquipment(equipment: PlayerLoadout['equipment']): Totals {
  const t = emptyTotals();
  for (const piece of Object.values(equipment)) {
    if (!piece) continue;
    t.off.stab += piece.offensive.stab;
    t.off.slash += piece.offensive.slash;
    t.off.crush += piece.offensive.crush;
    t.off.magic += piece.offensive.magic;
    t.off.ranged += piece.offensive.ranged;
    t.defn.stab += piece.defensive.stab;
    t.defn.slash += piece.defensive.slash;
    t.defn.crush += piece.defensive.crush;
    t.defn.magic += piece.defensive.magic;
    t.defn.ranged += piece.defensive.ranged;
    t.str += piece.bonuses.str;
    t.ranged_str += piece.bonuses.ranged_str;
    t.magic_str += piece.bonuses.magic_str;
    t.prayer += piece.bonuses.prayer;
    t.weight += piece.weight;
  }
  return t;
}

function s(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Bigger numbers earn warmer text — keeps zero-bonus values visually quiet
 *  so the eye lands on the loadout's actual investments. */
function tone(n: number): string {
  if (n === 0) return 'text-text-faint';
  if (n > 0) return 'text-text';
  return 'text-style-melee';
}

export function EquipmentTotals({ equipment, activeStyle }: Props) {
  const t = sumEquipment(equipment);
  const isEmpty =
    t.off.stab === 0 && t.off.slash === 0 && t.off.crush === 0 && t.off.magic === 0 && t.off.ranged === 0 &&
    t.defn.stab === 0 && t.defn.slash === 0 && t.defn.crush === 0 && t.defn.magic === 0 && t.defn.ranged === 0 &&
    t.str === 0 && t.ranged_str === 0 && t.magic_str === 0 && t.prayer === 0 && t.weight === 0;
  if (isEmpty) return null;

  // Map each column to the style whose accuracy roll it drives. Stab/slash/crush
  // are all melee; the lone magic + ranged columns are obvious. Used to highlight
  // the column that matches the user's selected combat style.
  const COL_STYLE: Record<'stab' | 'slash' | 'crush' | 'magic' | 'ranged', CombatStyle> = {
    stab: 'melee', slash: 'melee', crush: 'melee', magic: 'magic', ranged: 'ranged',
  };
  const COLS: Array<keyof typeof COL_STYLE> = ['stab', 'slash', 'crush', 'magic', 'ranged'];

  return (
    <>
      <div className="panel-heading mt-auto">Equipment totals</div>
      <div className="p-3">
        <div className="grid grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-x-3 gap-y-1 text-xs">
          {/* Header row — column labels keyed to combat-style names */}
          <span />
          {COLS.map((c) => {
            const isActive = activeStyle === COL_STYLE[c];
            return (
              <span
                key={c}
                className={[
                  'font-pixel text-[10px] uppercase tracking-wider text-center capitalize',
                  isActive ? 'text-accent' : 'text-text-faint',
                ].join(' ')}
              >
                {c}
              </span>
            );
          })}
          {/* Attack-bonus row */}
          <span className="text-text-dim">Attack</span>
          {COLS.map((c) => {
            const isActive = activeStyle === COL_STYLE[c];
            const v = t.off[c];
            return (
              <span
                key={c}
                className={[
                  'text-center tabular-nums',
                  tone(v),
                  isActive ? 'bg-accent/10 rounded' : '',
                ].join(' ')}
              >
                {s(v)}
              </span>
            );
          })}
          {/* Defence-bonus row */}
          <span className="text-text-dim">Defence</span>
          {COLS.map((c) => {
            const v = t.defn[c];
            return (
              <span key={c} className={['text-center tabular-nums', tone(v)].join(' ')}>
                {s(v)}
              </span>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <Bonus label="Strength" value={t.str} active={activeStyle === 'melee'} />
          <Bonus label="Ranged str" value={t.ranged_str} active={activeStyle === 'ranged'} />
          <Bonus label="Magic dmg" value={t.magic_str} suffix="%" active={activeStyle === 'magic'} />
          <Bonus label="Prayer" value={t.prayer} />
          <Bonus label="Weight" value={t.weight} suffix=" kg" rawSign />
        </div>
      </div>
    </>
  );
}

function Bonus({
  label,
  value,
  suffix = '',
  active = false,
  rawSign = false,
}: {
  label: string;
  value: number;
  suffix?: string;
  active?: boolean;
  rawSign?: boolean;
}) {
  const display = rawSign ? `${value}${suffix}` : `${s(value)}${suffix}`;
  return (
    <div
      className={[
        'flex items-center justify-between gap-2 px-1 -mx-1 rounded',
        active ? 'bg-accent/10' : '',
      ].join(' ')}
    >
      <span className="text-text-dim">{label}</span>
      <span
        className={[
          'tabular-nums',
          active ? 'text-accent font-semibold' : tone(value),
        ].join(' ')}
      >
        {display}
      </span>
    </div>
  );
}
