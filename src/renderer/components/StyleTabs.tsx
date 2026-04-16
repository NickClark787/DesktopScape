import type { CombatStyle } from '@shared/types';

interface Props {
  value: CombatStyle;
  onChange: (s: CombatStyle) => void;
}

const TABS: Array<{ id: CombatStyle; label: string; accent: string }> = [
  { id: 'melee', label: 'Melee', accent: 'text-style-melee' },
  { id: 'ranged', label: 'Ranged', accent: 'text-style-ranged' },
  { id: 'magic', label: 'Magic', accent: 'text-style-magic' },
];

export function StyleTabs({ value, onChange }: Props) {
  return (
    <div className="inline-flex gap-1 bg-bg-soft border border-border rounded-lg p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          className="pill-tab"
          data-active={value === t.id}
          onClick={() => onChange(t.id)}
        >
          <span className={value === t.id ? t.accent : ''}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
