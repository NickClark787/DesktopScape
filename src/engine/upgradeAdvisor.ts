/**
 * Upgrade advisor. Given the player's CURRENT loadout and a target's optimal
 * setup (from the optimizer), works out the most valuable single-slot changes
 * that move the current setup toward the optimum — each annotated with the DPS
 * it would gain and whether the player already owns the item.
 *
 * The optimum (`best`) is computed once by the caller via the existing
 * optimizer (so synergy/scaling items like Salve, Twisted bow, Dragon hunter,
 * powered staves are handled correctly). This module only does the cheap
 * marginal diff, so it can re-run on every loadout edit without re-optimizing:
 * as the player applies suggestions, the list shrinks live.
 *
 * Marginal framing:
 *  - Non-weapon slots are evaluated under the player's CURRENT weapon/stance,
 *    so the delta is the honest gain from that one piece.
 *  - The weapon is evaluated as a package (weapon + its paired ammo + clearing
 *    the shield if it's two-handed) under the optimum's stance/attack-style/
 *    spell, since a new weapon's value depends on all of those.
 */
import type {
  BestSetupCandidate,
  AttackType,
  EquipmentPiece,
  EquipmentSlot,
  Monster,
  PlayerLoadout,
  WeaponStance,
} from '@shared/types';
import { EQUIPMENT_SLOTS } from '@shared/types';
import { calcDps } from './formulas';

type Slot = Exclude<EquipmentSlot, '2h'>;

export interface UpgradeSuggestion {
  slot: Slot;
  /** The item to equip (the upgrade). */
  to: EquipmentPiece;
  /** What's currently in that slot, if anything. */
  from: EquipmentPiece | null;
  /** Equipment changes to apply for this upgrade (weapon swaps bundle ammo /
   *  shield-clear). Keyed by slot; null clears a slot. */
  changes: Partial<Record<Slot, EquipmentPiece | null>>;
  /** DPS after applying this single change. */
  dps: number;
  /** dps - baseline (always > 0 for a listed suggestion). */
  delta: number;
  /** delta / baseline, or null when the baseline is ~0 (e.g. unarmed). */
  pct: number | null;
  /** True when the player owns this item (ownedIds membership). */
  owned: boolean;
  /** For weapon swaps: the stance/attack-style/spell the delta was computed
   *  under, so applying the upgrade reproduces the shown DPS. */
  stance?: WeaponStance;
  attackStyle?: AttackType;
  spell?: string | null;
}

export interface UpgradeReport {
  /** DPS of the current loadout as-is. */
  baseline: number;
  /** DPS of the optimum the suggestions move toward. */
  bestDps: number;
  /** True when no positive single-slot change exists (already at the optimum
   *  reachable from here). */
  atOptimum: boolean;
  /** Positive single-slot upgrades, highest DPS gain first. */
  suggestions: UpgradeSuggestion[];
}

const EPS = 1e-6;
const NON_WEAPON_SLOTS = EQUIPMENT_SLOTS.filter((s) => s !== 'weapon') as Slot[];

const idOf = (p: EquipmentPiece | null | undefined): number | null => (p ? p.id : null);

export function findUpgrades(
  current: PlayerLoadout,
  target: Monster,
  best: BestSetupCandidate,
  ownedIds?: Set<number> | null,
): UpgradeReport {
  const baseline = calcDps(current, target).dps;
  const curEq = current.equipment;
  const bestEq = best.equipment;
  const isOwned = (p: EquipmentPiece) => !ownedIds || ownedIds.has(p.id);
  const pctOf = (delta: number) => (baseline > EPS ? delta / baseline : null);

  const suggestions: UpgradeSuggestion[] = [];

  // ----- Weapon package (weapon + paired ammo + shield-clear if 2h) -----
  const curWeapon = curEq.weapon ?? null;
  const bestWeapon = bestEq.weapon ?? null;
  const weaponChanged = !!bestWeapon && idOf(bestWeapon) !== idOf(curWeapon);
  if (weaponChanged && bestWeapon) {
    const changes: Partial<Record<Slot, EquipmentPiece | null>> = { weapon: bestWeapon };
    const bestAmmo = bestEq.ammo ?? null;
    if (idOf(bestAmmo) !== idOf(curEq.ammo)) changes.ammo = bestAmmo;
    if (bestWeapon.isTwoHanded) changes.shield = null;

    const eq = { ...curEq, ...changes };
    const dps = calcDps(
      { ...current, equipment: eq, stance: best.stance, attackStyle: best.attackStyle, spell: best.spell ?? current.spell },
      target,
    ).dps;
    const delta = dps - baseline;
    if (delta > EPS) {
      suggestions.push({
        slot: 'weapon', to: bestWeapon, from: curWeapon, changes,
        dps, delta, pct: pctOf(delta), owned: isOwned(bestWeapon),
        stance: best.stance, attackStyle: best.attackStyle, spell: best.spell ?? null,
      });
    }
  }

  // ----- Independent (non-weapon) slots, under the current weapon/stance -----
  for (const slot of NON_WEAPON_SLOTS) {
    const cur = curEq[slot] ?? null;
    const tgt = bestEq[slot] ?? null;
    if (!tgt || idOf(tgt) === idOf(cur)) continue;
    // A shield can't go over a two-handed weapon, and a fresh ammo pick is
    // already bundled into the weapon package — both are entangled with the
    // weapon change, so skip them as standalone rows when the weapon differs.
    if (slot === 'shield' && curEq.weapon?.isTwoHanded) continue;
    if (slot === 'ammo' && weaponChanged) continue;

    const changes = { [slot]: tgt } as Partial<Record<Slot, EquipmentPiece | null>>;
    const eq = { ...curEq, ...changes };
    const dps = calcDps({ ...current, equipment: eq }, target).dps;
    const delta = dps - baseline;
    if (delta > EPS) {
      suggestions.push({
        slot, to: tgt, from: cur, changes, dps, delta, pct: pctOf(delta), owned: isOwned(tgt),
      });
    }
  }

  suggestions.sort((a, b) => b.delta - a.delta);
  return { baseline, bestDps: best.result.dps, atOptimum: suggestions.length === 0, suggestions };
}
