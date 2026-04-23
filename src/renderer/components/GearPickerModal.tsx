import { useEffect, useMemo, useRef, useState } from 'react';
import fuzzysort from 'fuzzysort';
import type { EquipmentPiece, EquipmentSlot } from '@shared/types';
import { GearIcon } from './GearIcon';

type Slot = Exclude<EquipmentSlot, '2h'>;

interface Props {
  /** The slot the user clicked. Filters the candidate list. */
  slot: Slot;
  /** Full equipment list — same shape the optimizer sees. */
  equipment: EquipmentPiece[];
  /** Currently equipped piece in this slot, if any. Highlighted in the grid. */
  current: EquipmentPiece | null | undefined;
  /** Optional owned-only restriction. When non-null, only owned items appear. */
  ownedOnly: Set<number> | null;
  onPick: (piece: EquipmentPiece | null) => void;
  onClose: () => void;
}

const SLOT_TITLE: Record<Slot, string> = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo', weapon: 'Weapon',
  body: 'Body', shield: 'Shield', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
};

export function GearPickerModal({ slot, equipment, current, ownedOnly, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the search input on open and let Esc close the modal.
  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Candidates: pieces that fit the slot. Weapons in the slot include both
  // 1h weapons (slot==='weapon') and 2h weapons (slot==='2h'); the engine and
  // the optimizer treat both as weapon-eligible, so we mirror that here.
  const candidates = useMemo(() => {
    const slotMatches = (p: EquipmentPiece) =>
      p.slot === slot || (slot === 'weapon' && p.slot === '2h');
    let pool = equipment.filter(slotMatches);
    if (ownedOnly) pool = pool.filter((p) => ownedOnly.has(p.id));
    return pool;
  }, [equipment, slot, ownedOnly]);

  const results = useMemo(() => {
    if (!query.trim()) return candidates.slice(0, 200);
    const hits = fuzzysort.go(query, candidates, {
      keys: ['name', 'version'],
      limit: 200,
      threshold: -10000,
    });
    return hits.map((h) => h.obj);
  }, [candidates, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-h-[80vh] flex flex-col bg-bg-soft border border-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-heading flex items-center justify-between rounded-t-lg">
          <span>Pick a {SLOT_TITLE[slot].toLowerCase()}</span>
          <button onClick={onClose} className="text-text-faint hover:text-text px-2" title="Close (Esc)">×</button>
        </div>
        <div className="p-3 flex flex-col gap-3 min-h-0">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${SLOT_TITLE[slot].toLowerCase()}…`}
            className="w-full bg-bg-raised border border-border rounded px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex items-center justify-between text-xs text-text-faint">
            <span>{results.length} of {candidates.length}{ownedOnly ? ' owned' : ''}</span>
            {current && (
              <button
                onClick={() => { onPick(null); onClose(); }}
                className="hover:text-red-400"
              >
                Unequip current
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto rounded border border-border">
            {results.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-faint">
                {ownedOnly && candidates.length === 0
                  ? 'No owned items in this slot. Add some via the Owned-only filter.'
                  : 'No matches.'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {results.map((p) => {
                  const isCurrent = current?.id === p.id;
                  return (
                    <button
                      key={`${p.id}-${p.version}`}
                      onClick={() => { onPick(p); onClose(); }}
                      className={[
                        'w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition',
                        isCurrent ? 'bg-accent/10 text-accent' : 'hover:bg-bg-raised',
                      ].join(' ')}
                    >
                      <GearIcon piece={p} size="md" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">
                          {p.name}
                          {p.version && <span className="text-text-faint"> · {p.version}</span>}
                        </span>
                        <span className="block text-[11px] text-text-faint">
                          {summarizeStats(p)}
                        </span>
                      </span>
                      {isCurrent && <span className="text-[11px] uppercase tracking-wider">Equipped</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One-line stat summary for a list row. Picks the offensive style with the
 * largest bonus + the matching strength bonus, so a player can scan rows
 * for "what's actually different about this piece" without opening the
 * tooltip.
 */
function summarizeStats(p: EquipmentPiece): string {
  const off = p.offensive;
  const styles: Array<[string, number]> = [
    ['stab', off.stab], ['slash', off.slash], ['crush', off.crush],
    ['magic', off.magic], ['ranged', off.ranged],
  ];
  const top = styles.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
  const parts: string[] = [];
  if (top[1]) parts.push(`${top[0]} ${top[1] > 0 ? '+' : ''}${top[1]}`);
  const b = p.bonuses;
  if (b.str) parts.push(`str ${b.str > 0 ? '+' : ''}${b.str}`);
  if (b.ranged_str) parts.push(`rng str ${b.ranged_str > 0 ? '+' : ''}${b.ranged_str}`);
  if (b.magic_str) parts.push(`mag dmg ${b.magic_str > 0 ? '+' : ''}${b.magic_str}%`);
  if (b.prayer) parts.push(`pray ${b.prayer > 0 ? '+' : ''}${b.prayer}`);
  if (p.slot === 'weapon' && p.speed) parts.push(`spd ${p.speed}t`);
  return parts.join(' · ') || p.category || '—';
}
