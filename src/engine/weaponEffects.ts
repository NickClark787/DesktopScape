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

// -------------------------------------------------------------------------
// Crossbow bolt procs (ruby/diamond/onyx/dragonstone, dragon variants)
// -------------------------------------------------------------------------

function isCrossbow(weapon: EquipmentPiece | null): boolean {
  return !!weapon && /crossbow/i.test(weapon.category);
}

const RUBY_BOLTS_RE = /^Ruby (dragon )?bolts(?: \(e\))?$/i;
const DIAMOND_BOLTS_RE = /^Diamond (dragon )?bolts(?: \(e\))?$/i;
const ONYX_BOLTS_RE = /^Onyx (dragon )?bolts(?: \(e\))?$/i;
const DRAGONSTONE_BOLTS_RE = /^Dragonstone (dragon )?bolts(?: \(e\))?$/i;

const ENCHANTED_RE = /\(e\)$/i;

/**
 * Expected per-swing damage accounting for enchanted-bolt procs. Returns
 * null if the ammo isn't an enchanted crossbow bolt or the weapon isn't
 * a crossbow. Proc rates/effects from OSRS wiki.
 */
export function boltProcAvgPerSwing(
  weapon: EquipmentPiece | null,
  ammo: EquipmentPiece | null,
  maxHit: number,
  accuracy: number,
  monster: Monster,
): number | null {
  if (!isCrossbow(weapon) || !ammo || !ENCHANTED_RE.test(ammo.name)) return null;

  const normalAvg = accuracy * (maxHit / 2);
  const targetHp = monster.skills.hp || 1;

  // Ruby (e) — Blood Forfeit: 6% proc, deals 20% of target current HP, cap 100.
  if (RUBY_BOLTS_RE.test(ammo.name)) {
    const procDmg = Math.min(100, Math.floor(targetHp * 0.20));
    return 0.94 * normalAvg + 0.06 * procDmg;
  }

  // Diamond (e) — Armour Piercing: 10% proc, bypasses defense (100% acc) and +15% max hit.
  if (DIAMOND_BOLTS_RE.test(ammo.name)) {
    const procMax = Math.trunc(maxHit * 1.15);
    const procAvg = procMax / 2; // guaranteed to land
    return 0.90 * normalAvg + 0.10 * procAvg;
  }

  // Onyx (e) — Life Leech: 10% proc, +20% max hit; lifesteal doesn't change damage dealt.
  if (ONYX_BOLTS_RE.test(ammo.name)) {
    const procMax = Math.trunc(maxHit * 1.20);
    const procAvg = accuracy * (procMax / 2);
    return 0.90 * normalAvg + 0.10 * procAvg;
  }

  // Dragonstone (e) — Dragon's Breath: 6% proc, +20% max hit. Ineffective vs dragons/fire-immune.
  if (DRAGONSTONE_BOLTS_RE.test(ammo.name)) {
    const attrs = (monster.attributes || []).map((a) => a.toLowerCase());
    if (attrs.includes('dragon') || attrs.includes('fiery')) return normalAvg;
    const procMax = Math.trunc(maxHit * 1.20);
    const procAvg = accuracy * (procMax / 2);
    return 0.94 * normalAvg + 0.06 * procAvg;
  }

  return null;
}

/**
 * Entry point used by calcDps. Returns the expected damage per swing for any
 * special-behavior weapon, or null if the weapon is a standard single-hit.
 */
export function specialAvgPerSwing(
  weapon: EquipmentPiece | null,
  ammo: EquipmentPiece | null,
  maxHit: number,
  accuracy: number,
  monster: Monster,
): number | null {
  if (isScythe(weapon)) {
    return scytheAvgPerSwing(maxHit, accuracy, monster.size);
  }
  const bolt = boltProcAvgPerSwing(weapon, ammo, maxHit, accuracy, monster);
  if (bolt !== null) return bolt;
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
// Twisted bow — scales with target magic level
// -------------------------------------------------------------------------

export interface RangedWeaponMult {
  /** Multiplier applied to max hit AFTER the gear ranged_str bonus. */
  dmgMult: number;
  /** Multiplier applied to the ranged attack roll. */
  accMult: number;
}

const RANGED_IDENTITY: RangedWeaponMult = { dmgMult: 1, accMult: 1 };

/**
 * Twisted bow scales with the target's magic level. Formula from the OSRS
 * wiki (https://oldschool.runescape.wiki/w/Twisted_bow):
 *   M = min(target magic, 250)   (350 inside CoX — out of scope)
 *   accMod% = 140 + floor((3M - 10)/100) - floor(((3M/10 - 100)^2)/100)
 *   dmgMod% = 250 + floor((3M - 14)/100) - floor(((3M/10 - 140)^2)/100)
 *   accMod clamped to [0, 140], dmgMod clamped to [0, 250].
 *
 * Against low-magic targets both mods drop below 100% — TBow is a bad pick
 * there, which the optimizer needs to see.
 */
export function twistedBowMult(weapon: EquipmentPiece | null, monster: Monster): RangedWeaponMult {
  if (!weapon || weapon.name !== 'Twisted bow') return RANGED_IDENTITY;
  const m = Math.min(monster.skills.magic, 250);
  const accRaw = 140 + Math.trunc((3 * m - 10) / 100) - Math.trunc(((3 * m / 10 - 100) ** 2) / 100);
  const dmgRaw = 250 + Math.trunc((3 * m - 14) / 100) - Math.trunc(((3 * m / 10 - 140) ** 2) / 100);
  const accPct = Math.max(0, Math.min(140, accRaw));
  const dmgPct = Math.max(0, Math.min(250, dmgRaw));
  return { dmgMult: dmgPct / 100, accMult: accPct / 100 };
}

// -------------------------------------------------------------------------
// Demonbane weapons — Arclight / Emberlight / Darklight
// -------------------------------------------------------------------------

function isDemon(monster: Monster): boolean {
  return (monster.attributes || []).some((a) => a.toLowerCase() === 'demon');
}

/**
 * Melee demonbane weapons (dmg + acc multiplier against demon-attribute
 * monsters). Lesser demons actually get 100% of the bonus; K'ril, Nechryael,
 * Balfrug Kreeyath, Skotizo etc. qualify as demons in the monster data.
 * Emberlight is the 2024 upgrade that replaces Arclight.
 */
export function demonbaneMult(weapon: EquipmentPiece | null, monster: Monster): { dmgMult: number; accMult: number } {
  if (!weapon || !isDemon(monster)) return { dmgMult: 1, accMult: 1 };
  if (weapon.name === 'Emberlight') return { dmgMult: 1.7, accMult: 1.7 };
  if (weapon.name === 'Arclight') return { dmgMult: 1.7, accMult: 1.7 };
  if (weapon.name === 'Darklight') return { dmgMult: 1.6, accMult: 1.6 };
  if (weapon.name === 'Silverlight') return { dmgMult: 1.6, accMult: 1.6 };
  if (weapon.name === 'Silverlight (dyed)') return { dmgMult: 1.6, accMult: 1.6 };
  return { dmgMult: 1, accMult: 1 };
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
