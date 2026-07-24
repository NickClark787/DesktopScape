/**
 * Inferno configuration panels: latency, boss/practice options, assists,
 * player stats, keybinds. Pure controlled components — state lives in
 * InfernoTab.
 */
import { useState } from 'react';
import type { PlayerSkills } from '@shared/types';
import { INFERNO_MODIFIERS } from '@sim/tzkalZuk/constants';
import type { AssistOptions, BossOptions, LatencyConfig } from '@sim/tzkalZuk/types';
import { DEFAULT_KEYMAP, KEY_ACTION_LABELS, saveKeymap, type KeyAction } from '../../inferno/keymap';

export function LatencyPanel({ latency, onChange }: { latency: LatencyConfig; onChange: (l: LatencyConfig) => void }) {
  const zero = latency.pingMs === 0 && latency.jitterMs === 0 && latency.packetLossPct === 0;
  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Ping / latency</span>
        <span className="panel-heading-meta">{zero ? 'tick-perfect' : `${latency.pingMs}ms`}</span>
      </div>
      <div className="p-3 flex flex-col gap-2 text-sm">
        {([['Ping', 'pingMs', 300, 5], ['Jitter ±', 'jitterMs', 100, 5], ['Packet loss', 'packetLossPct', 25, 1]] as const).map(
          ([label, key, max, step]) => (
            <label key={key} className="flex items-center justify-between gap-2">
              <span className="text-text-dim">{label}</span>
              <span className="flex items-center gap-2">
                <input type="range" min={0} max={max} step={step} value={latency[key]}
                  onChange={(e) => onChange({ ...latency, [key]: Number(e.target.value) })} className="accent-accent w-32" />
                <span className="tabular-nums w-14 text-right">{latency[key]}{key === 'packetLossPct' ? '%' : ' ms'}</span>
              </span>
            </label>
          ),
        )}
        <button className="btn text-xs self-start" onClick={() => onChange({ pingMs: 0, jitterMs: 0, packetLossPct: 0 })}>
          Tick-perfect (0 ms) reference
        </button>
        <p className="text-[11px] text-text-faint leading-snug">
          Inputs land on the first tick boundary after they arrive — ping is what makes prayer
          switches on Jad and the magers arrive a tick late.
        </p>
      </div>
    </div>
  );
}

export function BossOptionsPanel({ boss, onChange }: { boss: BossOptions; onChange: (b: BossOptions) => void }) {
  return (
    <div className="panel">
      <div className="panel-heading">Fight options</div>
      <div className="p-3 flex flex-col gap-3 text-sm">
        <label className="flex items-center justify-between gap-2">
          <span className="text-text-dim">Starting Zuk HP %</span>
          <input type="number" min={1} max={100} value={boss.startHpPct}
            onChange={(e) => onChange({ ...boss, startHpPct: Math.max(1, Math.min(100, Number(e.target.value) || 100)) })}
            className="num-input" />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-text-dim text-xs">Practice mode</span>
          <select
            className="w-full bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
            value={boss.practiceMode}
            onChange={(e) => onChange({ ...boss, practiceMode: e.target.value as BossOptions['practiceMode'] })}
          >
            <option value="full">Full fight</option>
            <option value="zukOnly">Zuk + glyph only (shuffle practice)</option>
            <option value="sets">Zuk + add sets (no Jad/healers)</option>
            <option value="jad">Start at the Jad spawn (480 HP)</option>
            <option value="healers">Start at enrage + healers (240 HP)</option>
          </select>
          <label className="flex items-center gap-2 mt-1 cursor-pointer">
            <input type="checkbox" checked={boss.freezeGlyph}
              onChange={(e) => onChange({ ...boss, freezeGlyph: e.target.checked })} className="accent-accent" />
            <span>Freeze the glyph (positioning practice)</span>
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-text-dim text-xs">Modifiers</span>
          {INFERNO_MODIFIERS.map((m) => (
            <label key={m.id} className="flex items-center gap-2 cursor-pointer text-xs" title={m.description}>
              <input
                type="checkbox"
                checked={boss.modifierIds.includes(m.id)}
                onChange={(e) => onChange({
                  ...boss,
                  modifierIds: e.target.checked ? [...boss.modifierIds, m.id] : boss.modifierIds.filter((x) => x !== m.id),
                })}
                className="accent-accent"
              />
              {m.name}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AssistsPanel({ assists, onChange }: { assists: AssistOptions; onChange: (a: AssistOptions) => void }) {
  const rows: Array<[keyof AssistOptions, string]> = [
    ['glyphSafeHighlight', 'Glyph safe-zone highlight'],
    ['addTimers', 'Add attack timers'],
    ['jadPrayerIndicator', 'Jad prayer indicator'],
    ['setCountdown', 'Next-set countdown'],
  ];
  const anyOn = rows.some(([k]) => assists[k]);
  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Assists</span>
        {anyOn && <span className="panel-heading-meta text-accent">flagged in results</span>}
      </div>
      <div className="p-3 flex flex-col gap-1 text-sm">
        {rows.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={assists[k]} onChange={(e) => onChange({ ...assists, [k]: e.target.checked })} className="accent-accent" />
            <span>{label}</span>
          </label>
        ))}
        <p className="text-[11px] text-text-faint leading-snug">All default off; results are marked when any were on.</p>
      </div>
    </div>
  );
}

export function StatsEditor({ skills, onChange }: { skills: PlayerSkills; onChange: (s: PlayerSkills) => void }) {
  const rows: Array<[keyof PlayerSkills, string]> = [
    ['ranged', 'Ranged'], ['hp', 'Hitpoints'], ['def', 'Defence'],
    ['prayer', 'Prayer'], ['magic', 'Magic'], ['atk', 'Attack'], ['str', 'Strength'],
  ];
  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Player stats</span>
        <button className="panel-heading-meta hover:text-parchment-ink"
          onClick={() => onChange({ atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 })}>
          maxed
        </button>
      </div>
      <div className="p-3 grid grid-cols-2 gap-2 text-sm">
        {rows.map(([k, label]) => (
          <label key={k} className="flex items-center justify-between gap-2">
            <span className="text-text-dim">{label}</span>
            <input type="number" min={1} max={99} value={skills[k]}
              onChange={(e) => onChange({ ...skills, [k]: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
              className="num-input" />
          </label>
        ))}
      </div>
    </div>
  );
}

export function KeybindPanel({ keys, onChange }: { keys: Record<KeyAction, string>; onChange: (k: Record<KeyAction, string>) => void }) {
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Keybinds</span>
        <button className="panel-heading-meta hover:text-parchment-ink" onClick={() => setOpen((v) => !v)}>{open ? 'hide' : 'edit'}</button>
      </div>
      {open && (
        <div className="p-3 flex flex-col gap-1 text-xs">
          {(Object.keys(KEY_ACTION_LABELS) as KeyAction[]).map((action) => (
            <div key={action} className="flex items-center justify-between gap-2">
              <span className="text-text-dim">{KEY_ACTION_LABELS[action]}</span>
              <button
                className={`btn text-[11px] !px-2 !py-0.5 min-w-[64px] ${capturing === action ? 'border-accent text-accent' : ''}`}
                onClick={() => setCapturing(action)}
                onKeyDown={(e) => {
                  if (capturing !== action) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const next = { ...keys, [action]: e.key.toLowerCase() };
                  onChange(next);
                  saveKeymap(next);
                  setCapturing(null);
                }}
              >
                {capturing === action ? 'press…' : keys[action] === ' ' ? 'Space' : keys[action]}
              </button>
            </div>
          ))}
          <button className="btn text-xs self-start mt-1" onClick={() => { onChange({ ...DEFAULT_KEYMAP }); saveKeymap({ ...DEFAULT_KEYMAP }); }}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
