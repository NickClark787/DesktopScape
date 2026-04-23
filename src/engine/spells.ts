/**
 * Magic spell + powered-staff logic. Ported from weirdgloop/osrs-dps-calc
 * (GPL-3.0), simplified to the pieces we need for best-setup optimization.
 */

import spellsJson from '@data/spells.json' assert { type: 'json' };
import type { EquipmentPiece } from '@shared/types';

export type Spellbook = 'standard' | 'ancient' | 'lunar' | 'arceuus';
export type Spellement = 'air' | 'water' | 'earth' | 'fire' | null;

export interface Spell {
  name: string;
  image: string;
  max_hit: number;
  spellbook: Spellbook;
  element: Spellement;
}

export const spells: Spell[] = spellsJson as Spell[];

const SPELL_INDEX = new Map(spells.map((s) => [s.name, s] as const));

export function spellByName(name: string | null | undefined): Spell | null {
  if (!name) return null;
  return SPELL_INDEX.get(name) ?? null;
}

/** Offensive standard/ancient spells the optimizer should try. */
export const CANDIDATE_SPELL_NAMES = [
  'Fire Surge',
  'Fire Wave',
  'Ice Barrage',
  'Blood Barrage',
  'Magic Dart',
  'Flames of Zamorak',
];

/**
 * Bolt-class standard spellbook spell? (Wind/Water/Earth/Fire Bolt). Used by
 * Chaos gauntlets which add +3 max hit on Bolt spells only.
 */
export function isBoltSpell(spell: Spell | null | undefined): boolean {
  if (!spell || spell.spellbook !== 'standard') return false;
  return /^(Wind|Water|Earth|Fire) Bolt$/.test(spell.name);
}

/**
 * Element prefix of an Ancient-spellbook offensive spell (Smoke/Shadow/Blood/Ice
 * Rush/Burst/Blitz/Barrage). Returns null for spells outside that family.
 * Used to match Ancient sceptre variants to matching-element spells.
 */
export type AncientElement = 'smoke' | 'shadow' | 'blood' | 'ice';
export function ancientSpellElement(spell: Spell | null | undefined): AncientElement | null {
  if (!spell || spell.spellbook !== 'ancient') return null;
  const m = spell.name.match(/^(Smoke|Shadow|Blood|Ice) (Rush|Burst|Blitz|Barrage)$/);
  if (!m) return null;
  return m[1].toLowerCase() as AncientElement;
}

/**
 * Magic Dart needs a Slayer's staff to cast and its max hit depends on the
 * staff variant. Returns 0 if no compatible staff is wielded.
 *   - Slayer's staff:     max hit = floor(magic / 10) + 10
 *   - Slayer's staff (e): max hit = floor(magic / 6)  + 13
 */
export function magicDartMaxHit(weapon: EquipmentPiece | null | undefined, magicLevel: number): number {
  const name = weapon?.name ?? '';
  if (name === "Slayer's staff (e)") return Math.trunc(magicLevel / 6) + 13;
  if (name === "Slayer's staff") return Math.trunc(magicLevel / 10) + 10;
  return 0;
}

export function getSpellMaxHit(
  spell: Spell,
  magicLevel: number,
  weapon?: EquipmentPiece | null,
): number {
  if (spell.name === 'Magic Dart') return magicDartMaxHit(weapon, magicLevel);
  if (!spell.element || spell.name === 'Flames of Cerberus') {
    return spell.max_hit;
  }
  const [, spellClass] = spell.name.split(/\s+/);
  const table: Record<string, Array<[number, number]>> = {
    Strike: [[13, 8], [9, 6], [5, 4], [0, 2]],
    Bolt:   [[35, 12], [29, 10], [23, 8], [0, 6]],
    Blast:  [[59, 16], [53, 14], [47, 12], [0, 10]],
    Wave:   [[75, 20], [70, 18], [65, 16], [0, 14]],
    Surge:  [[95, 24], [90, 22], [85, 20], [0, 18]],
  };
  const rows = table[spellClass];
  if (!rows) return spell.max_hit;
  for (const [reqLvl, dmg] of rows) {
    if (magicLevel >= reqLvl) return dmg;
  }
  return rows[rows.length - 1][1];
}

// -------------------------------------------------------------------------
// Powered staff detection
// -------------------------------------------------------------------------

export function isPoweredStaff(weapon: EquipmentPiece | null | undefined): boolean {
  return !!weapon && weapon.category === 'Powered Staff';
}

export function isSalamander(weapon: EquipmentPiece | null | undefined): boolean {
  return !!weapon && weapon.category === 'Salamander';
}

/**
 * Max hit for a powered staff (or salamander) at a given magic level. Returns
 * null if the weapon isn't a known powered staff.
 */
export function poweredStaffMaxHit(weaponName: string, magicLevel: number): number | null {
  switch (weaponName) {
    case 'Starter staff': return 8;
    case 'Trident of the seas':
    case 'Trident of the seas (e)':
      return Math.max(1, Math.trunc(magicLevel / 3 - 5));
    case "Thammaron's sceptre":
      return Math.max(1, Math.trunc(magicLevel / 3 - 8));
    case 'Accursed sceptre':
      return Math.max(1, Math.trunc(magicLevel / 3 - 6));
    case 'Trident of the swamp':
    case 'Trident of the swamp (e)':
      return Math.max(1, Math.trunc(magicLevel / 3 - 2));
    case 'Sanguinesti staff':
    case 'Holy sanguinesti staff':
      return Math.max(1, Math.trunc(magicLevel / 3 - 1));
    case 'Dawnbringer':
      return Math.max(1, Math.trunc(magicLevel / 6 - 1));
    case "Tumeken's shadow":
      return Math.max(1, Math.trunc(magicLevel / 3) + 1);
    case 'Eye of ayak':
      return Math.max(1, Math.trunc(magicLevel / 3) - 6);
    case 'Lithic sceptre':
      return Math.max(10, Math.trunc(magicLevel / 3) - 10);
    case 'Warped sceptre':
      return Math.max(1, Math.trunc((8 * magicLevel + 96) / 37));
    case 'Bone staff':
      return Math.max(1, Math.trunc(magicLevel / 3) - 5) + 10;
    case 'Crystal staff (basic)':
    case 'Corrupted staff (basic)':
      return 23;
    case 'Crystal staff (attuned)':
    case 'Corrupted staff (attuned)':
      return 31;
    case 'Crystal staff (perfected)':
    case 'Corrupted staff (perfected)':
      return 39;
    case 'Swamp lizard':
      return Math.trunc((magicLevel * (56 + 64) + 320) / 640);
    case 'Orange salamander':
      return Math.trunc((magicLevel * (59 + 64) + 320) / 640);
    case 'Red salamander':
      return Math.trunc((magicLevel * (77 + 64) + 320) / 640);
    case 'Black salamander':
      return Math.trunc((magicLevel * (92 + 64) + 320) / 640);
    case 'Tecu salamander':
      return Math.trunc((magicLevel * (104 + 64) + 320) / 640);
    default:
      return null;
  }
}

/** Tumeken's shadow triples the player's magic damage bonus (cap 100%). Inside ToA it's x4 — out of scope here. */
export function shadowDamageMultiplier(weaponName: string): number {
  if (weaponName === "Tumeken's shadow") return 3;
  return 1;
}

/** Does this weapon support manual spell-casting? Standard/ancient staves do; powered staves do not. */
export function allowsSpellCasting(weapon: EquipmentPiece | null | undefined): boolean {
  if (!weapon) return false; // unarmed — can't cast
  const c = weapon.category;
  return c === 'Staff' || c === 'Bladed Staff' || c === 'Polestaff';
}
