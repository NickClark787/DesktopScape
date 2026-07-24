import type { EquipmentPiece, EquipmentSlot, PlayerLoadout } from '@shared/types';

type Slot = Exclude<EquipmentSlot, '2h'>;

/**
 * Apply a manual slot edit with the 2h⇆shield mutual exclusion: equipping a
 * two-handed weapon clears the shield; equipping a shield over a 2h weapon
 * clears the weapon (the incoming piece always wins). Passing `null`
 * unequips the slot with no side effects.
 *
 * Single source of truth for manual-edit semantics — used by the store's
 * setSlot, App.pickSlot, and the gear picker's per-row DPS probe, which
 * previously each carried their own copy of this logic. (The optimizer's
 * normalizeMutex is intentionally different: there the 2h weapon wins.)
 */
export function applySlotChange(
  equipment: PlayerLoadout['equipment'],
  slot: Slot,
  piece: EquipmentPiece | null,
): PlayerLoadout['equipment'] {
  const next = { ...equipment, [slot]: piece };
  if (piece) {
    if (slot === 'weapon' && piece.isTwoHanded) next.shield = null;
    else if (slot === 'shield' && next.weapon?.isTwoHanded) next.weapon = null;
  }
  return next;
}
