import type { CombatStyle, Potions } from '@shared/types';

interface Props {
  style: CombatStyle;
  potions: Potions;
  onChange: <K extends keyof Potions>(k: K, v: Potions[K]) => void;
}

const MELEE: Array<[Potions['melee'], string]> = [
  ['none', 'None'],
  ['attack', 'Attack'],
  ['strength', 'Strength'],
  ['combat', 'Combat'],
  ['super_attack', 'Super att'],
  ['super_strength', 'Super str'],
  ['super_combat', 'Super combat'],
  ['overload', 'Overload'],
];
const RANGED: Array<[Potions['ranged'], string]> = [
  ['none', 'None'], ['ranging', 'Ranging'], ['super_ranging', 'Super rng'],
  ['divine_ranging', 'Divine rng'], ['overload', 'Overload'],
];
const MAGIC: Array<[Potions['magic'], string]> = [
  ['none', 'None'], ['magic', 'Magic'], ['imbued_heart', 'Imbued heart'],
  ['saturated_heart', 'Saturated heart'], ['ancient_brew', 'Ancient brew'],
  ['forgotten_brew', 'Forgotten brew'], ['overload', 'Overload'],
];

export function PotionPanel({ style, potions, onChange }: Props) {
  return (
    <div className="panel">
      <div className="panel-heading">Potion</div>
      <div className="p-3">
        {style === 'melee' && (
          <select
            value={potions.melee}
            onChange={(e) => onChange('melee', e.target.value as Potions['melee'])}
            className="w-full bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            {MELEE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {style === 'ranged' && (
          <select
            value={potions.ranged}
            onChange={(e) => onChange('ranged', e.target.value as Potions['ranged'])}
            className="w-full bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            {RANGED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {style === 'magic' && (
          <select
            value={potions.magic}
            onChange={(e) => onChange('magic', e.target.value as Potions['magic'])}
            className="w-full bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            {MAGIC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
