import type { CombatStyle, MeleeAttackType, WeaponStance } from '@shared/types';

interface Props {
  style: CombatStyle;
  stance: WeaponStance | null;
  attackStyle: MeleeAttackType | null;
  onStanceChange: (v: WeaponStance | null) => void;
  onAttackStyleChange: (v: MeleeAttackType | null) => void;
}

const STANCES_BY_STYLE: Record<CombatStyle, Array<[WeaponStance, string]>> = {
  melee: [
    ['accurate', 'Accurate'],
    ['aggressive', 'Aggressive'],
    ['controlled', 'Controlled'],
    ['defensive', 'Defensive'],
  ],
  ranged: [
    ['accurate', 'Accurate'],
    ['rapid', 'Rapid'],
    ['longrange', 'Longrange'],
  ],
  magic: [
    ['accurate', 'Accurate'],
    ['longrange', 'Longrange'],
  ],
};

const ATTACK_STYLES: Array<[MeleeAttackType, string]> = [
  ['stab', 'Stab'],
  ['slash', 'Slash'],
  ['crush', 'Crush'],
];

const selectClass =
  'w-full bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent';

export function OverridesPanel({ style, stance, attackStyle, onStanceChange, onAttackStyleChange }: Props) {
  const stances = STANCES_BY_STYLE[style];
  return (
    <div className="panel">
      <div className="panel-heading">Overrides</div>
      <div className="p-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-faint">
          Stance
          <select
            className={selectClass}
            value={stance ?? ''}
            onChange={(e) => onStanceChange(e.target.value === '' ? null : (e.target.value as WeaponStance))}
          >
            <option value="">Auto</option>
            {stances.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-faint">
          Melee attack
          <select
            className={selectClass}
            value={attackStyle ?? ''}
            disabled={style !== 'melee'}
            onChange={(e) => onAttackStyleChange(e.target.value === '' ? null : (e.target.value as MeleeAttackType))}
          >
            <option value="">Auto</option>
            {ATTACK_STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
