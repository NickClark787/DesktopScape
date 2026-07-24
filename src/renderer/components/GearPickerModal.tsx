import { useEffect, useMemo, useRef, useState } from 'react';
import fuzzysort from 'fuzzysort';
import type { AttackType, EquipmentPiece, EquipmentSlot, MeleeAttackType, Monster, PlayerLoadout, WeaponStance } from '@shared/types';
import { calcDps, stancesForStyle } from '../../engine/formulas';
import { GearIcon } from './GearIcon';
import { applySlotChange } from '../utils/equipment';
import { summarizeStats } from '../utils/itemStats';

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
  /** Avoid-list: items the user never wants suggested. Hidden from the picker. */
  excludedIds?: Set<number> | null;
  /**
   * Effective loadout — used as the substitution base when computing per-row
   * DPS deltas. Pass the same loadout `App.pickSlot` would apply (i.e. with
   * the candidate's stance/attackStyle folded in if a candidate exists), so
   * delta = "DPS if I pick this row" - "DPS as currently equipped".
   */
  loadout: PlayerLoadout;
  /** Target monster — when null, the picker falls back to a stats summary. */
  target: Monster | null;
  /**
   * Called when the user picks a piece (or chooses Unequip — `piece === null`).
   * For weapon swaps, `hint.stance` and `hint.attackStyle` carry the
   * combination the picker found best for the new weapon — App should apply
   * them so the engine sees the stance the displayed DPS was computed under.
   */
  onPick: (
    piece: EquipmentPiece | null,
    hint?: { stance?: WeaponStance; attackStyle?: AttackType },
  ) => void;
  onClose: () => void;
}

const SLOT_TITLE: Record<Slot, string> = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo', weapon: 'Weapon',
  body: 'Body', shield: 'Shield', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
};

export function GearPickerModal({ slot, equipment, current, ownedOnly, excludedIds, loadout, target, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  // Default sort to DPS-desc when we have a target — that's almost always
  // what the user is trying to do ("show me upgrades"). Falls back to the
  // fuzzysort score when typing a query (so "ber" still surfaces Berserker
  // ring at the top even if it's not the highest-DPS option).
  const [sortByDps, setSortByDps] = useState(true);
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
    if (excludedIds?.size) pool = pool.filter((p) => !excludedIds.has(p.id));
    return pool;
  }, [equipment, slot, ownedOnly, excludedIds]);

  const results = useMemo(() => {
    if (!query.trim()) return candidates.slice(0, 200);
    const hits = fuzzysort.go(query, candidates, {
      keys: ['name', 'version'],
      limit: 200,
      threshold: -10000,
    });
    return hits.map((h) => h.obj);
  }, [candidates, query]);

  // Baseline DPS — what the loadout currently produces against the target.
  // Null when no monster is selected (delta column is hidden in that case).
  const baselineDps = useMemo(() => {
    if (!target) return null;
    return calcDps(loadout, target).dps;
  }, [loadout, target]);

  /**
   * Per-candidate DPS computed by substituting the candidate into `slot` and
   * running calcDps. Map keyed by `${id}-${version}` so two variants of the
   * same item don't collide.
   *
   * For weapon swaps we additionally probe the valid stance × attack-style
   * combinations and keep the max-DPS pick — the prior stance/attack-style
   * was tied to the *previous* weapon and may not even be valid for the new
   * one (e.g. swapping a stab dagger to a slash scimitar). Carrying the
   * picked stance/attackStyle in the value lets App apply them on click,
   * keeping the engine's view consistent.
   *
   * Cost ceiling: 200 weapon candidates × ~3 melee styles × ~3 stances ≈
   * 1800 calcDps calls per render. Each call is straight-line math, well
   * under a frame.
   */
  const dpsByKey = useMemo(() => {
    const map = new Map<string, { dps: number; stance: WeaponStance; attackStyle: AttackType }>();
    if (!target) return map;
    const baseStance: WeaponStance = loadout.stance ?? 'accurate';
    const baseAttack: AttackType = loadout.attackStyle;
    for (const p of results) {
      const nextEquipment = applySlotChange(loadout.equipment, slot, p);

      // Non-weapon swaps inherit the current stance/attackStyle — gear
      // pieces don't change which stances are available, and re-probing
      // would just add noise.
      if (slot !== 'weapon') {
        const r = calcDps({ ...loadout, equipment: nextEquipment }, target);
        map.set(`${p.id}-${p.version}`, { dps: r.dps, stance: baseStance, attackStyle: baseAttack });
        continue;
      }

      // Weapon swap: iterate stance × attack-style and keep the winner.
      const stances = stancesForStyle(loadout.style);
      const attackStyles: AttackType[] =
        loadout.style === 'melee' ? (['stab', 'slash', 'crush'] as MeleeAttackType[]) : [loadout.style];
      let best: { dps: number; stance: WeaponStance; attackStyle: AttackType } | null = null;
      for (const st of stances) {
        for (const atk of attackStyles) {
          const r = calcDps(
            { ...loadout, equipment: nextEquipment, stance: st, attackStyle: atk },
            target,
          );
          if (!best || r.dps > best.dps) best = { dps: r.dps, stance: st, attackStyle: atk };
        }
      }
      if (best) map.set(`${p.id}-${p.version}`, best);
    }
    return map;
  }, [results, loadout, target, slot]);

  // Apply the DPS sort on top of the fuzzysort/array-order results. We sort
  // in a separate memo so the dpsByKey computation isn't repeated when the
  // user just toggles the sort.
  const sortedResults = useMemo(() => {
    if (!sortByDps || !target) return results;
    return [...results].sort((a, b) => {
      const da = dpsByKey.get(`${a.id}-${a.version}`)?.dps ?? -Infinity;
      const db = dpsByKey.get(`${b.id}-${b.version}`)?.dps ?? -Infinity;
      return db - da;
    });
  }, [results, dpsByKey, sortByDps, target]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 animate-backdrop-in"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-h-[80vh] flex flex-col bg-bg-soft border border-border-strong rounded-lg shadow-2xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-heading flex items-center justify-between rounded-t-lg">
          <span>Pick a {SLOT_TITLE[slot].toLowerCase()}</span>
          <button
            onClick={onClose}
            className="text-parchment-ink-dim hover:text-parchment-ink px-2"
            title="Close (Esc)"
            aria-label="Close picker"
          >×</button>
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
            <div className="flex items-center gap-3">
              {target && (
                <label className="flex items-center gap-1.5 cursor-pointer hover:text-text">
                  <input
                    type="checkbox"
                    checked={sortByDps}
                    onChange={(e) => setSortByDps(e.target.checked)}
                    className="accent-accent"
                  />
                  Sort by DPS
                </label>
              )}
              {current && (
                <button
                  onClick={() => { onPick(null); onClose(); }}
                  className="hover:text-osrs-red"
                >
                  Unequip current
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto rounded border border-border">
            {sortedResults.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-faint">
                {ownedOnly && candidates.length === 0
                  ? 'No owned items in this slot. Add some via the Owned-only filter.'
                  : 'No matches.'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {sortedResults.map((p) => {
                  const isCurrent = current?.id === p.id;
                  const entry = dpsByKey.get(`${p.id}-${p.version}`);
                  const dps = entry?.dps;
                  const delta = dps !== undefined && baselineDps !== null ? dps - baselineDps : null;
                  // For weapon swaps, surface when the picker had to switch
                  // stance or attack style for this weapon — otherwise the
                  // user has no visibility into "why does this DPS look
                  // different from what I'd expect".
                  const stanceChanged = entry && slot === 'weapon' && entry.stance !== (loadout.stance ?? 'accurate');
                  const attackChanged = entry && slot === 'weapon' && loadout.style === 'melee' && entry.attackStyle !== loadout.attackStyle;
                  return (
                    <button
                      key={`${p.id}-${p.version}`}
                      onClick={() => {
                        onPick(p, entry ? { stance: entry.stance, attackStyle: entry.attackStyle } : undefined);
                        onClose();
                      }}
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
                          {(stanceChanged || attackChanged) && (
                            <span className="text-accent"> · auto: {[
                              attackChanged && entry!.attackStyle,
                              stanceChanged && entry!.stance,
                            ].filter(Boolean).join(' / ')}</span>
                          )}
                        </span>
                      </span>
                      {dps !== undefined && delta !== null && (
                        <span className="flex flex-col items-end shrink-0 tabular-nums">
                          <span className="text-xs text-text-dim">{dps.toFixed(2)} dps</span>
                          <DeltaPill delta={delta} />
                        </span>
                      )}
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
 * Tiny color-coded chip for the per-row DPS delta. Green for upgrades, red
 * for downgrades, faint zero for "no change". Threshold of 0.005 dps (well
 * under any meaningful difference) collapses floating-point noise into "0.00".
 */
function DeltaPill({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.005) {
    return <span className="text-[11px] text-text-faint">±0.00</span>;
  }
  const positive = delta > 0;
  return (
    <span
      className={[
        'text-[11px] font-medium',
        positive ? 'text-osrs-green' : 'text-osrs-red',
      ].join(' ')}
    >
      {positive ? '+' : ''}{delta.toFixed(2)}
    </span>
  );
}

// (Row stat summaries come from utils/itemStats.summarizeStats — shared with
// the gear tooltips so the magic-damage unit conversion lives in one place.)
