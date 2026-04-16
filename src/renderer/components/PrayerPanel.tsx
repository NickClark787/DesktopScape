import type { CombatStyle, Prayers } from '@shared/types';

interface Props {
  style: CombatStyle;
  prayers: Prayers;
  onToggle: (k: keyof Prayers) => void;
}

const MELEE: Array<[keyof Prayers, string]> = [
  ['clarityOfThought', 'Clarity'], ['burstOfStrength', 'Burst of Str'],
  ['improvedReflexes', 'Improved Ref'], ['superhumanStrength', 'Superhuman Str'],
  ['incredibleReflexes', 'Incredible Ref'], ['ultimateStrength', 'Ultimate Str'],
  ['chivalry', 'Chivalry'], ['piety', 'Piety'],
];
const RANGED: Array<[keyof Prayers, string]> = [
  ['sharpEye', 'Sharp Eye'], ['hawkEye', 'Hawk Eye'],
  ['eagleEye', 'Eagle Eye'], ['rigour', 'Rigour'],
];
const MAGIC: Array<[keyof Prayers, string]> = [
  ['mysticWill', 'Mystic Will'], ['mysticLore', 'Mystic Lore'],
  ['mysticMight', 'Mystic Might'], ['augury', 'Augury'],
];

export function PrayerPanel({ style, prayers, onToggle }: Props) {
  const entries = style === 'melee' ? MELEE : style === 'ranged' ? RANGED : MAGIC;
  return (
    <div className="panel">
      <div className="panel-heading">Prayers</div>
      <div className="p-3 grid grid-cols-2 gap-1">
        {entries.map(([k, label]) => {
          const on = prayers[k];
          return (
            <button
              key={k}
              onClick={() => onToggle(k)}
              className={[
                'text-xs px-2 py-1.5 rounded border text-left transition',
                on ? 'bg-accent/15 border-accent/60 text-accent'
                   : 'bg-bg-raised border-border text-text-dim hover:text-text',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
