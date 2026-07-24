/**
 * In-memory patches applied to the OSRS Wiki CDN data after load.
 *
 * The upstream JSON occasionally ships entries whose stats don't match the
 * actual in-game item — usually because the wiki's data table is built from
 * an old definition or includes practice/event variants alongside combat
 * items. Patching here (rather than asking users to re-fetch corrected data)
 * keeps the fix transparent and survives a Refresh.
 *
 * Each patch lists the upstream value, the corrected value, and a one-line
 * justification. Add new entries here as they're identified — keep the
 * upstream-authoritative data file untouched.
 */

import type { EquipmentPiece } from './types';

interface EquipmentPatch {
  /** Exact name match — version-agnostic, applies to every variant. */
  name: string;
  /** Mutator. Receives the piece (which is a fresh object from JSON.parse,
   *  safe to mutate). Document why in a comment. */
  apply: (p: EquipmentPiece) => void;
}

const EQUIPMENT_PATCHES: EquipmentPatch[] = [
  // ---------------------------------------------------------------------
  // Training arrows — upstream data assigns +125 ranged_str to four arrow
  // variants that are practice/event items in OSRS and don't actually deal
  // combat damage. Without this, the optimizer picks "Barbed arrow" as BiS
  // ammo for any bow setup, since +125 beats Dragon arrow's +60.
  //
  // Setting to 0 across the board reflects the in-game reality (these
  // arrows have no functional combat stats) and pushes Dragon arrow back
  // to the top of the BiS list where it belongs.
  // ---------------------------------------------------------------------
  {
    name: 'Barbed arrow',
    apply: (p) => { p.bonuses.ranged_str = 0; p.offensive.ranged = 0; },
  },
  {
    name: 'Blunt arrow',
    apply: (p) => { p.bonuses.ranged_str = 0; p.offensive.ranged = 0; },
  },
  {
    name: 'Bullet arrow',
    apply: (p) => { p.bonuses.ranged_str = 0; p.offensive.ranged = 0; },
  },
  {
    name: 'Field arrow',
    apply: (p) => { p.bonuses.ranged_str = 0; p.offensive.ranged = 0; },
  },
  // ---------------------------------------------------------------------
  // Castle Wars supply ammo — free minigame-only projectiles that cannot
  // leave the arena, yet upstream ships them with real combat stats
  // (bolts +122 ranged_str = dragon-bolt tier, arrows +60 = dragon-arrow
  // tier). Same failure mode as the training arrows above: the optimizer
  // recommends ammo no player can actually bring to a fight.
  // ---------------------------------------------------------------------
  {
    name: 'Castle wars arrow',
    apply: (p) => { p.bonuses.ranged_str = 0; p.offensive.ranged = 0; },
  },
  {
    name: 'Castle wars bolts',
    apply: (p) => { p.bonuses.ranged_str = 0; p.offensive.ranged = 0; },
  },
];

/**
 * Apply all known patches to a fresh equipment array. Mutates entries
 * in-place — the caller already owns the JSON.parse output.
 */
export function patchEquipmentData(equipment: EquipmentPiece[]): void {
  for (const patch of EQUIPMENT_PATCHES) {
    for (const piece of equipment) {
      if (piece.name === patch.name) patch.apply(piece);
    }
  }
}
