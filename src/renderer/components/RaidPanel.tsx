import type { RaidKind, RaidScaling } from '@shared/types';

interface Props {
  value: RaidScaling | undefined;
  onChange: (v: RaidScaling | undefined) => void;
}

const KINDS: Array<[RaidKind | 'none', string]> = [
  ['none', 'None'],
  ['toa', 'Tombs of Amascut'],
  ['cox', 'Chambers of Xeric'],
  ['tob', 'Theatre of Blood'],
];

const PARTY_LIMITS: Record<RaidKind, { min: number; max: number }> = {
  toa: { min: 1, max: 8 },
  cox: { min: 1, max: 15 },
  tob: { min: 1, max: 5 },
};

function clampPartySize(kind: RaidKind, n: number): number {
  const { min, max } = PARTY_LIMITS[kind];
  return Math.max(min, Math.min(max, Math.floor(n) || min));
}

function defaultsFor(kind: RaidKind): RaidScaling {
  if (kind === 'toa') return { kind, partySize: 1, raidLevel: 300, pathLevel: 0 };
  if (kind === 'cox') return { kind, partySize: 1, challengeMode: false };
  return { kind: 'tob', partySize: 5 };
}

export function RaidPanel({ value, onChange }: Props) {
  const kind: RaidKind | 'none' = value?.kind ?? 'none';

  function setKind(k: RaidKind | 'none') {
    if (k === 'none') return onChange(undefined);
    onChange(defaultsFor(k));
  }

  function patch(p: Partial<RaidScaling>) {
    if (!value) return;
    onChange({ ...value, ...p } as RaidScaling);
  }

  return (
    <div className="panel">
      <div className="panel-heading">Raid scaling</div>
      <div className="p-3 flex flex-col gap-3">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as RaidKind | 'none')}
          className="w-full bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        {value && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-text-dim">Party size</span>
            <input
              type="number"
              min={PARTY_LIMITS[value.kind].min}
              max={PARTY_LIMITS[value.kind].max}
              value={value.partySize}
              onChange={(e) => patch({ partySize: clampPartySize(value.kind, Number(e.target.value)) })}
              className="num-input"
            />
          </label>
        )}

        {value?.kind === 'toa' && (
          <>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-text-dim">Raid level</span>
              <input
                type="number"
                min={0}
                max={700}
                step={10}
                value={value.raidLevel ?? 0}
                onChange={(e) => patch({ raidLevel: Math.max(0, Math.min(700, Math.floor(Number(e.target.value)) || 0)) })}
                className="num-input"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-text-dim">Path level</span>
              <input
                type="number"
                min={0}
                max={6}
                value={value.pathLevel ?? 0}
                onChange={(e) => patch({ pathLevel: Math.max(0, Math.min(6, Math.floor(Number(e.target.value)) || 0)) })}
                className="num-input"
              />
            </label>
            <p className="text-xs text-text-faint leading-snug">
              Path level only adds HP to path bosses (Akkha, Ba-Ba, Kephri, Zebak).
            </p>
          </>
        )}

        {value?.kind === 'cox' && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={value.challengeMode ?? false}
              onChange={(e) => patch({ challengeMode: e.target.checked })}
              className="accent-accent"
            />
            <span>Challenge mode (+50% HP)</span>
          </label>
        )}

        {value?.kind === 'tob' && (
          <p className="text-xs text-text-faint leading-snug">
            Pick the Entry / Normal / Hard mode variant in the monster list. Party
            size scales HP linearly: 1p ≈ 90%, 5p = 100%.
          </p>
        )}
      </div>
    </div>
  );
}
