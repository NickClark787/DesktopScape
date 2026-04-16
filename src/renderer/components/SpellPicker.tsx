import { CANDIDATE_SPELL_NAMES } from '../../engine/spells';

interface Props {
  value: string | null;
  onChange: (v: string | null) => void;
}

export function SpellPicker({ value, onChange }: Props) {
  return (
    <div className="panel">
      <div className="panel-heading">Spell</div>
      <div className="p-3">
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          <option value="">Auto (optimizer picks)</option>
          {CANDIDATE_SPELL_NAMES.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <p className="mt-2 text-[11px] text-text-faint">
          Ignored when a powered staff or salamander is equipped (max hit uses the weapon's formula).
        </p>
      </div>
    </div>
  );
}
