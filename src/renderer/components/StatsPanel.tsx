import type { PlayerSkills } from '@shared/types';

interface Props {
  skills: PlayerSkills;
  onChange: (k: keyof PlayerSkills, v: number) => void;
  onSlayerTask: boolean;
  inWilderness: boolean;
  onSlayerChange: (v: boolean) => void;
  onWildernessChange: (v: boolean) => void;
}

const ROWS: Array<{ k: keyof PlayerSkills; label: string }> = [
  { k: 'atk', label: 'Attack' },
  { k: 'str', label: 'Strength' },
  { k: 'def', label: 'Defence' },
  { k: 'ranged', label: 'Ranged' },
  { k: 'magic', label: 'Magic' },
  { k: 'hp', label: 'Hitpoints' },
  { k: 'prayer', label: 'Prayer' },
];

export function StatsPanel(props: Props) {
  return (
    <div className="panel">
      <div className="panel-heading">Stats</div>
      <div className="p-3 grid grid-cols-2 gap-2">
        {ROWS.map((r) => (
          <label key={r.k} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-text-dim">{r.label}</span>
            <input
              type="number"
              min={1}
              max={125}
              value={props.skills[r.k]}
              onChange={(e) => props.onChange(r.k, Math.max(1, Math.min(125, Number(e.target.value) || 1)))}
              className="num-input"
            />
          </label>
        ))}
      </div>
      <div className="px-3 pb-3 pt-1 flex flex-col gap-1 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.onSlayerTask}
            onChange={(e) => props.onSlayerChange(e.target.checked)}
            className="accent-accent"
          />
          <span>On Slayer task</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.inWilderness}
            onChange={(e) => props.onWildernessChange(e.target.checked)}
            className="accent-accent"
          />
          <span>In Wilderness</span>
        </label>
      </div>
    </div>
  );
}
