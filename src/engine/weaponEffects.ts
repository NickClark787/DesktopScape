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
export function isDualMacuahuitl(weapon: EquipmentPiece | null | undefined): boolean {
  return !!weapon && weapon.name === 'Dual macuahuitl';
}

/**
 * Dual macuahuitl (Blood Moon weapon) hits twice per swing, sharing a single
 * accuracy roll. Each hit rolls damage uniformly in [0, max/2], so the
 * expected damage on a successful swing is `2 * max/4 = max/2` — effectively
 * the same as a single hit at full max. The blood-moon-set synergy (bonus on
 * crit, heal) is out of scope; this just models the two-hit mechanic.
 */
export function dualMacuahuitlAvgPerSwing(maxHit: number, accuracy: number): number {
  return accuracy * (maxHit / 2) * 2;
}

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
  if (isDualMacuahuitl(weapon)) {
    return dualMacuahuitlAvgPerSwing(maxHit, accuracy);
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
// Dragon hunter weapons — DHL / DHCB / DHW
// -------------------------------------------------------------------------

function isDragon(monster: Monster): boolean {
  return (monster.attributes || []).some((a) => a.toLowerCase() === 'dragon');
}

/**
 * Dragon hunter weapons vs dragon-attribute monsters.
 *   - Dragon hunter lance: +20% dmg & acc (melee).
 *   - Dragon hunter crossbow: +30% dmg, +30% acc (ranged).
 *   - Dragon hunter wand: +50% acc, +20% dmg (magic).
 * Returns identity when weapon or target doesn't qualify.
 */
export function dragonHunterMult(
  weapon: EquipmentPiece | null,
  monster: Monster,
): { dmgMult: number; accMult: number } {
  if (!weapon || !isDragon(monster)) return { dmgMult: 1, accMult: 1 };
  if (weapon.name === 'Dragon hunter lance') return { dmgMult: 1.20, accMult: 1.20 };
  if (weapon.name === 'Dragon hunter crossbow') return { dmgMult: 1.30, accMult: 1.30 };
  if (weapon.name === 'Dragon hunter wand') return { dmgMult: 1.20, accMult: 1.50 };
  return { dmgMult: 1, accMult: 1 };
}

/**
 * Scorching bow — ranged demonbane equivalent. +30% dmg & acc vs demons.
 */
export function scorchingBowMult(
  weapon: EquipmentPiece | null,
  monster: Monster,
): { dmgMult: number; accMult: number } {
  if (!weapon || weapon.name !== 'Scorching bow') return { dmgMult: 1, accMult: 1 };
  if (!isDemon(monster)) return { dmgMult: 1, accMult: 1 };
  return { dmgMult: 1.30, accMult: 1.30 };
}

// -------------------------------------------------------------------------
// Obsidian armour + Berserker necklace synergy
// -------------------------------------------------------------------------

const OBSIDIAN_HELM_RE = /^Obsidian helmet$/i;
const OBSIDIAN_BODY_RE = /^Obsidian platebody$/i;
const OBSIDIAN_LEGS_RE = /^Obsidian platelegs$/i;
const OBSIDIAN_MELEE_WEAPONS = new Set([
  'Toktz-xil-ak',       // sword
  'Tzhaar-ket-em',      // mace
  'Tzhaar-ket-om',      // maul
  'Tzhaar-ket-om (t)',
  'Toktz-xil-ek',       // dagger
]);

function isObsidianMeleeWeapon(weapon: EquipmentPiece | null): boolean {
  return !!weapon && OBSIDIAN_MELEE_WEAPONS.has(weapon.name);
}

/**
 * Obsidian armour set (helm + body + legs) gives +10% acc & dmg when wielding
 * an obsidian melee weapon. Multiplicative on max hit and attack roll.
 */
export function obsidianArmourBonus(
  eq: PlayerLoadout['equipment'],
): { dmgMult: number; accMult: number } {
  const weapon = eq.weapon ?? null;
  if (!isObsidianMeleeWeapon(weapon)) return { dmgMult: 1, accMult: 1 };
  const head = eq.head?.name ?? '';
  const body = eq.body?.name ?? '';
  const legs = eq.legs?.name ?? '';
  const full = OBSIDIAN_HELM_RE.test(head) && OBSIDIAN_BODY_RE.test(body) && OBSIDIAN_LEGS_RE.test(legs);
  if (!full) return { dmgMult: 1, accMult: 1 };
  return { dmgMult: 1.10, accMult: 1.10 };
}

/**
 * Berserker necklace adds +20% damage with obsidian melee weapons. Stacks
 * multiplicatively with the Obsidian armour set bonus. No accuracy effect.
 */
export function berserkerNeckBonus(
  eq: PlayerLoadout['equipment'],
): { dmgMult: number; accMult: number } {
  const weapon = eq.weapon ?? null;
  if (!isObsidianMeleeWeapon(weapon)) return { dmgMult: 1, accMult: 1 };
  if (eq.neck?.name === 'Berserker necklace' || eq.neck?.name === 'Berserker necklace (or)') {
    return { dmgMult: 1.20, accMult: 1 };
  }
  return { dmgMult: 1, accMult: 1 };
}

// -------------------------------------------------------------------------
// Virtus robes — ancient-spellbook damage bonus
// -------------------------------------------------------------------------

const VIRTUS_HELM_RE = /^Virtus mask$/i;
const VIRTUS_TOP_RE = /^Virtus robe top$/i;
const VIRTUS_LEGS_RE = /^Virtus robe bottom$/i;

/**
 * Virtus robes give +3% magic damage per piece while casting ancient
 * spellbook spells (helm + top + legs = +9% total). No accuracy effect.
 * Applied multiplicatively to max hit after other magic bonuses.
 */
export function virtusBonus(
  eq: PlayerLoadout['equipment'],
  spell: Spell | null,
): { dmgMult: number; accMult: number } {
  if (!spell || spell.spellbook !== 'ancient') return { dmgMult: 1, accMult: 1 };
  let pieces = 0;
  if (eq.head && VIRTUS_HELM_RE.test(eq.head.name)) pieces++;
  if (eq.body && VIRTUS_TOP_RE.test(eq.body.name)) pieces++;
  if (eq.legs && VIRTUS_LEGS_RE.test(eq.legs.name)) pieces++;
  if (pieces === 0) return { dmgMult: 1, accMult: 1 };
  return { dmgMult: 1 + 0.03 * pieces, accMult: 1 };
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
// Void Knight / Elite Void set bonuses
// -------------------------------------------------------------------------

const VOID_MELEE_HELM_RE = /^Void melee helm( \(or\))?$/i;
const VOID_RANGER_HELM_RE = /^Void ranger helm( \(or\))?$/i;
const VOID_MAGE_HELM_RE = /^Void mage helm( \(or\))?$/i;
const VOID_TOP_RE = /^Void knight top$/i;
const VOID_ROBE_RE = /^Void knight robe$/i;
const ELITE_VOID_TOP_RE = /^Elite void top$/i;
const ELITE_VOID_ROBE_RE = /^Elite void robe$/i;
const VOID_GLOVES_RE = /^Void knight gloves$/i;

interface VoidSet {
  tier: 'void' | 'elite';
  helm: 'melee' | 'ranger' | 'mage';
}

function detectVoidSet(eq: PlayerLoadout['equipment']): VoidSet | null {
  const head = eq.head?.name ?? '';
  const body = eq.body?.name ?? '';
  const legs = eq.legs?.name ?? '';
  const hands = eq.hands?.name ?? '';
  if (!VOID_GLOVES_RE.test(hands)) return null;
  const hasRegularTop = VOID_TOP_RE.test(body);
  const hasRegularRobe = VOID_ROBE_RE.test(legs);
  const hasEliteTop = ELITE_VOID_TOP_RE.test(body);
  const hasEliteRobe = ELITE_VOID_ROBE_RE.test(legs);
  const topOk = hasRegularTop || hasEliteTop;
  const robeOk = hasRegularRobe || hasEliteRobe;
  if (!topOk || !robeOk) return null;
  const tier: VoidSet['tier'] = hasEliteTop && hasEliteRobe ? 'elite' : 'void';
  if (VOID_MELEE_HELM_RE.test(head)) return { tier, helm: 'melee' };
  if (VOID_RANGER_HELM_RE.test(head)) return { tier, helm: 'ranger' };
  if (VOID_MAGE_HELM_RE.test(head)) return { tier, helm: 'mage' };
  return null;
}

/**
 * Void Knight equipment set bonuses. Requires all 4 pieces (style helm + top
 * + robe + gloves). Melee helm gives +10% acc & str; ranger helm +10% acc &
 * ranged str (elite adds another +2.5% str); mage helm +45% magic acc (elite
 * adds +2.5% magic dmg). Mismatched helm/style returns identity.
 */
export function voidBonus(
  eq: PlayerLoadout['equipment'],
  style: CombatStyle,
): { dmgMult: number; accMult: number } {
  const set = detectVoidSet(eq);
  if (!set) return { dmgMult: 1, accMult: 1 };
  if (style === 'melee' && set.helm === 'melee') {
    return { dmgMult: 1.10, accMult: 1.10 };
  }
  if (style === 'ranged' && set.helm === 'ranger') {
    const dmg = set.tier === 'elite' ? 1.125 : 1.10;
    return { dmgMult: dmg, accMult: 1.10 };
  }
  if (style === 'magic' && set.helm === 'mage') {
    const dmg = set.tier === 'elite' ? 1.025 : 1.00;
    return { dmgMult: dmg, accMult: 1.45 };
  }
  return { dmgMult: 1, accMult: 1 };
}

// -------------------------------------------------------------------------
// Crystal armour + Crystal bow / Bow of Faerdhinen
// -------------------------------------------------------------------------

const CRYSTAL_HELM_RE = /^Crystal helm$/i;
const CRYSTAL_BODY_RE = /^Crystal body$/i;
const CRYSTAL_LEGS_RE = /^Crystal legs$/i;
const CRYSTAL_BOW_RE = /^(Bow of faerdhinen|Crystal bow)$/i;

/**
 * Crystal armour only boosts Crystal bow and Bow of Faerdhinen. Per-piece:
 *   helm  +2.5% dmg, +5% acc
 *   body  +7.5% dmg, +15% acc
 *   legs  +5% dmg, +10% acc
 * Full set: +15% dmg, +30% acc. Bonuses stack additively and are only
 * applied to the charged/active versions — but we match on name alone and
 * trust upstream gear selection to pick the charged variant.
 */
export function crystalArmourBonus(
  eq: PlayerLoadout['equipment'],
): { dmgMult: number; accMult: number } {
  const weapon = eq.weapon ?? null;
  if (!weapon || !CRYSTAL_BOW_RE.test(weapon.name)) return { dmgMult: 1, accMult: 1 };
  let dmg = 0;
  let acc = 0;
  if (eq.head && CRYSTAL_HELM_RE.test(eq.head.name)) { dmg += 0.025; acc += 0.05; }
  if (eq.body && CRYSTAL_BODY_RE.test(eq.body.name)) { dmg += 0.075; acc += 0.15; }
  if (eq.legs && CRYSTAL_LEGS_RE.test(eq.legs.name)) { dmg += 0.05; acc += 0.10; }
  return { dmgMult: 1 + dmg, accMult: 1 + acc };
}

// -------------------------------------------------------------------------
// Keris / Keris partisan — kalphite/scarab procs
// -------------------------------------------------------------------------

const KERIS_RE = /^Keris/i;
const KERIS_DMG_PARTISAN_RE = /^(Keris partisan|Keris partisan of corruption|Keris partisan of the sun)$/i;
const KERIS_ACC_PARTISAN_RE = /^(Keris partisan of corruption)$/i;

function isKalphiteOrScarab(monster: Monster): boolean {
  const attrs = (monster.attributes || []).map((a) => a.toLowerCase());
  return attrs.includes('kalphite') || attrs.includes('scarab');
}

/**
 * Keris family bonus vs kalphite/scarab attribute monsters.
 *   - All Keris variants: 1/51 chance to deal triple damage. Expected avg
 *     damage multiplier on a hit = (50/51) + (1/51)*3 = 52/51 ≈ 1.0196.
 *   - Keris partisan / of corruption / of the sun: +33% passive damage.
 *   - Keris partisan of corruption: also +33% accuracy.
 * Returns acc/damage multipliers (max hit & attack roll) plus an avg-damage
 * multiplier applied per-swing (for the triple-damage expected value).
 */
export function kerisBonus(
  weapon: EquipmentPiece | null,
  monster: Monster,
): { dmgMult: number; accMult: number; avgDmgMult: number } {
  if (!weapon || !KERIS_RE.test(weapon.name) || !isKalphiteOrScarab(monster)) {
    return { dmgMult: 1, accMult: 1, avgDmgMult: 1 };
  }
  const dmgMult = KERIS_DMG_PARTISAN_RE.test(weapon.name) ? 1.33 : 1;
  const accMult = KERIS_ACC_PARTISAN_RE.test(weapon.name) ? 1.33 : 1;
  const avgDmgMult = 52 / 51;
  return { dmgMult, accMult, avgDmgMult };
}

// -------------------------------------------------------------------------
// Harmonised nightmare staff — standard spellbook speed boost
// -------------------------------------------------------------------------

/**
 * Harmonised nightmare staff casts standard-spellbook spells one tick faster
 * (5t → 4t). Returns the adjusted weapon speed when applicable, else the
 * base speed unchanged.
 */
export function harmonisedSpeedOverride(
  weapon: EquipmentPiece | null,
  spell: Spell | null,
  baseSpeed: number,
): number {
  if (weapon && weapon.name === 'Harmonised nightmare staff' && spell && spell.spellbook === 'standard') {
    return Math.max(1, baseSpeed - 1);
  }
  return baseSpeed;
}

// -------------------------------------------------------------------------
// Inquisitor's armour — crush-only set bonus
// -------------------------------------------------------------------------

const INQUISITOR_PIECES: Record<'head' | 'body' | 'legs', RegExp> = {
  head: /^Inquisitor's great helm$/i,
  body: /^Inquisitor's hauberk$/i,
  legs: /^Inquisitor's plateskirt$/i,
};

/**
 * Inquisitor's armour: +0.5% damage & accuracy per piece on crush attacks,
 * rounded up to +2.5% (2.5× the per-piece amount) when all three are worn
 * (head + body + legs). Bonus only applies to crush-type melee attacks.
 */
export function inquisitorBonus(
  equipment: PlayerLoadout['equipment'],
  attackStyle: PlayerLoadout['attackStyle'],
): { dmgMult: number; accMult: number } {
  if (attackStyle !== 'crush') return { dmgMult: 1, accMult: 1 };
  let count = 0;
  const head = equipment.head ?? null;
  const body = equipment.body ?? null;
  const legs = equipment.legs ?? null;
  if (head && INQUISITOR_PIECES.head.test(head.name)) count++;
  if (body && INQUISITOR_PIECES.body.test(body.name)) count++;
  if (legs && INQUISITOR_PIECES.legs.test(legs.name)) count++;
  if (count === 0) return { dmgMult: 1, accMult: 1 };
  const pct = count === 3 ? 0.025 : count * 0.005;
  return { dmgMult: 1 + pct, accMult: 1 + pct };
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
