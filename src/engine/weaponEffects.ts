/**
 * Weapon-specific DPS modifiers. Most OSRS weapons use the standard
 * "single hit, accuracy × maxHit / 2 per swing" model. A handful deviate:
 * Scythe hits up to 3 times per swing, Dual macuahuitl hits twice,
 * Osmumten's fang rerolls low damage, Dragon claws has a special-attack
 * multi-hit pattern (out of scope — specials are per-activation).
 *
 * This module exposes per-weapon helpers. Each returns an "avg damage per
 * swing" value given a precomputed base (single-hit) maxHit and accuracy.
 */

import type { CombatStyle, EquipmentPiece, Monster, PlayerLoadout } from '@shared/types';
import type { Spell } from './spells';

const SCYTHE_NAMES = new Set([
  'Scythe of vitur',
  'Holy scythe of vitur',
  'Sanguine scythe of vitur',
]);

export function isScythe(weapon: EquipmentPiece | null | undefined): boolean {
  return !!weapon && SCYTHE_NAMES.has(weapon.name);
}

/**
 * Scythe of vitur hits 1-3 times per swing:
 *   hit 1 at 100% max, hit 2 at 50%, hit 3 at 25%.
 * Hit 2 only lands if the monster is at least size 2 (2×2 tile), hit 3
 * needs size 3+. Each hit rolls accuracy independently.
 */
export function scytheAvgPerSwing(maxHit: number, accuracy: number, monsterSize: number): number {
  const hits: number[] = [maxHit];
  if (monsterSize >= 2) hits.push(Math.floor(maxHit / 2));
  if (monsterSize >= 3) hits.push(Math.floor(maxHit / 4));
  return hits.reduce((sum, h) => sum + accuracy * (h / 2), 0);
}

/**
 * Entry point used by calcDps. Returns the expected damage per swing for any
 * special-behavior weapon, or null if the weapon is a standard single-hit.
 */
export function specialAvgPerSwing(
  weapon: EquipmentPiece | null,
  maxHit: number,
  accuracy: number,
  monster: Monster,
): number | null {
  if (isScythe(weapon)) {
    return scytheAvgPerSwing(maxHit, accuracy, monster.size);
  }
  return null;
}

// -------------------------------------------------------------------------
// Elemental magic weapon/book bonuses
// -------------------------------------------------------------------------

export interface MagicWeaponMult {
  /** Multiplier applied to max hit AFTER the gear magic damage bonus. */
  dmgMult: number;
  /** Multiplier applied to the magic attack roll. */
  accMult: number;
}

const MAGIC_MULT_IDENTITY: MagicWeaponMult = { dmgMult: 1, accMult: 1 };

/**
 * Books, tomes and elemental staves that give a per-spell multiplier on top
 * of the player's gear magic damage bonus. Tome of fire/water go in the
 * shield slot; smoke/staff-of-the-dead etc. are wielded.
 */
export function magicWeaponMult(
  weapon: EquipmentPiece | null,
  shield: EquipmentPiece | null,
  spell: Spell | null,
): MagicWeaponMult {
  if (!spell) return MAGIC_MULT_IDENTITY;

  // Tome of fire — +50% dmg & accuracy for fire spells.
  if (shield && /^Tome of fire/i.test(shield.name) && spell.element === 'fire') {
    return { dmgMult: 1.5, accMult: 1.5 };
  }
  // Tome of water — +20% dmg & accuracy for water spells.
  if (shield && /^Tome of water/i.test(shield.name) && spell.element === 'water') {
    return { dmgMult: 1.2, accMult: 1.2 };
  }
  // Tome of earth — +20% dmg & accuracy for earth spells.
  if (shield && /^Tome of earth/i.test(shield.name) && spell.element === 'earth') {
    return { dmgMult: 1.2, accMult: 1.2 };
  }

  if (!weapon) return MAGIC_MULT_IDENTITY;

  // Smoke battlestaff / Mystic smoke staff — +10% dmg & accuracy for standard-book spells.
  if (/smoke (battlestaff|staff)/i.test(weapon.name) && spell.spellbook === 'standard') {
    return { dmgMult: 1.1, accMult: 1.1 };
  }
  // Staff of the dead / Staff of light / Toxic staff of the dead — +15% dmg on Flames of Zamorak.
  if (spell.name === 'Flames of Zamorak' && /staff of (the dead|light)/i.test(weapon.name)) {
    return { dmgMult: 1.15, accMult: 1 };
  }

  return MAGIC_MULT_IDENTITY;
}

// -------------------------------------------------------------------------
// Target-type bonuses (Salve amulet, Slayer helm/Black mask)
// -------------------------------------------------------------------------

export interface TargetBonus {
  dmgMult: number;
  accMult: number;
}

const TARGET_IDENTITY: TargetBonus = { dmgMult: 1, accMult: 1 };

function isUndead(monster: Monster): boolean {
  return (monster.attributes || []).some((a) => a.toLowerCase() === 'undead');
}

const SALVE_RE = /^Salve amulet\s*(\(e\)|\(i\)|\(ei\))?$/i;
const SLAYER_HELM_I_RE = /^Slayer helmet\s*\(i\)/i;
const BLACK_MASK_I_RE = /^Black mask\s*\(i\)/i;

/**
 * Salve amulet / Slayer helm / Black mask damage and accuracy bonuses.
 * Salve applies vs undead, slayer helm (i) / black mask (i) apply only while
 * `onSlayerTask`. Salve and slayer helm DO NOT stack — Salve wins when both
 * would apply. Returns identity when nothing applies.
 */
export function targetTypeBonus(
  loadout: PlayerLoadout,
  monster: Monster,
  style: CombatStyle,
): TargetBonus {
  const neck = loadout.equipment.neck ?? null;
  const head = loadout.equipment.head ?? null;

  if (neck && SALVE_RE.test(neck.name) && isUndead(monster)) {
    const m = neck.name.match(SALVE_RE);
    const variant = (m?.[1] || '').toLowerCase();
    if (variant === '(ei)') return { dmgMult: 1.2, accMult: 1.2 };
    if (variant === '(i)') {
      if (style === 'ranged' || style === 'magic') return { dmgMult: 1.15, accMult: 1.15 };
      if (style === 'melee') return { dmgMult: 7 / 6, accMult: 7 / 6 };
    }
    if (variant === '(e)') {
      if (style === 'melee') return { dmgMult: 1.2, accMult: 1.2 };
    }
    if (!variant) {
      if (style === 'melee') return { dmgMult: 7 / 6, accMult: 7 / 6 };
    }
  }

  if (loadout.onSlayerTask && head && (SLAYER_HELM_I_RE.test(head.name) || BLACK_MASK_I_RE.test(head.name))) {
    if (style === 'melee') return { dmgMult: 7 / 6, accMult: 7 / 6 };
    if (style === 'ranged' || style === 'magic') return { dmgMult: 1.15, accMult: 1.15 };
  }

  return TARGET_IDENTITY;
}
