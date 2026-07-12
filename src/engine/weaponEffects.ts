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

import type { CombatStyle, EquipmentPiece, Monster, PlayerLoadout, RaidScaling } from '@shared/types';
import { ancientSpellElement, isBoltSpell, type Spell } from './spells';

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

/**
 * Zaryte crossbow enhances enchanted-bolt effects by ~10%. Per wiki:
 *   - Ruby: dmg of current HP 20% → 22%, cap 100 → 110
 *   - Diamond: max hit mult 1.15 → 1.26
 *   - Onyx: max hit mult 1.20 → 1.32
 *   - Dragonstone: max hit mult 1.20 → 1.32
 * (Jade/red topaz/sapphire don't benefit due to rounding — we don't model those.)
 * Wiki: https://oldschool.runescape.wiki/w/Zaryte_crossbow
 */
function isZcb(weapon: EquipmentPiece | null): boolean {
  return !!weapon && /^Zaryte crossbow$/i.test(weapon.name);
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
  const zcb = isZcb(weapon);

  // Ruby (e) — Blood Forfeit: 6% proc, deals 20% of target current HP, cap 100.
  // ZCB: 22% / cap 110.
  if (RUBY_BOLTS_RE.test(ammo.name)) {
    const dmgPct = zcb ? 0.22 : 0.20;
    const cap = zcb ? 110 : 100;
    const procDmg = Math.min(cap, Math.floor(targetHp * dmgPct));
    return 0.94 * normalAvg + 0.06 * procDmg;
  }

  // Diamond (e) — Armour Piercing: 10% proc, bypasses defense (100% acc) and +15% max hit.
  // ZCB: max hit mult 1.26.
  if (DIAMOND_BOLTS_RE.test(ammo.name)) {
    const mult = zcb ? 1.26 : 1.15;
    const procMax = Math.trunc(maxHit * mult);
    const procAvg = procMax / 2; // guaranteed to land
    return 0.90 * normalAvg + 0.10 * procAvg;
  }

  // Onyx (e) — Life Leech: 11% proc, +20% max hit; lifesteal doesn't change damage dealt.
  // ZCB: max hit mult 1.32. Proc only fires on a landing hit, and is ineffective
  // vs undead (no life to leech). Matches lib/dists/bolts.ts onyxBolts.
  if (ONYX_BOLTS_RE.test(ammo.name)) {
    const undead = (monster.attributes || []).some((a) => a.toLowerCase() === 'undead');
    if (undead) return normalAvg;
    const mult = zcb ? 1.32 : 1.20;
    const procMax = Math.trunc(maxHit * mult);
    const procAvg = accuracy * (procMax / 2);
    return 0.89 * normalAvg + 0.11 * procAvg;
  }

  // Dragonstone (e) — Dragon's Breath: 6% proc, +20% max hit. Ineffective vs dragons/fire-immune.
  // ZCB: max hit mult 1.32.
  if (DRAGONSTONE_BOLTS_RE.test(ammo.name)) {
    const attrs = (monster.attributes || []).map((a) => a.toLowerCase());
    if (attrs.includes('dragon') || attrs.includes('fiery')) return normalAvg;
    const mult = zcb ? 1.32 : 1.20;
    const procMax = Math.trunc(maxHit * mult);
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
 * Blood Moon set effect (Perilous Moons): with full set + Dual macuahuitl,
 * each landed hit has a 33% chance to make the next swing arrive 1 tick early.
 * Macuahuitl swings hit twice (sharing one accuracy roll), so the swing-level
 * proc chance is 1 - (2/3)^2 = 5/9 ≈ 55.56%, *conditional on the swing landing*.
 *
 * Average speed reduction in ticks per swing = accuracy × 5/9.
 *
 * Returns 0 when the set isn't equipped or the weapon isn't Macuahuitl.
 * Wiki: https://oldschool.runescape.wiki/w/Blood_moon_armour
 */
const BLOOD_MOON_PROC = 5 / 9;

function isBloodMoonPiece(piece: EquipmentPiece | null | undefined, slotName: string): boolean {
  if (!piece) return false;
  const want = `Blood moon ${slotName}`.toLowerCase();
  return piece.name.toLowerCase() === want;
}

export function isFullBloodMoonSet(eq: {
  head?: EquipmentPiece | null;
  body?: EquipmentPiece | null;
  legs?: EquipmentPiece | null;
}): boolean {
  return (
    isBloodMoonPiece(eq.head, 'helm') &&
    isBloodMoonPiece(eq.body, 'chestplate') &&
    isBloodMoonPiece(eq.legs, 'tassets')
  );
}

export function bloodMoonSpeedReduction(
  weapon: EquipmentPiece | null,
  accuracy: number,
  eq: { head?: EquipmentPiece | null; body?: EquipmentPiece | null; legs?: EquipmentPiece | null },
): number {
  if (!isDualMacuahuitl(weapon)) return 0;
  if (!isFullBloodMoonSet(eq)) return 0;
  return accuracy * BLOOD_MOON_PROC;
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

/**
 * Eclipse Moon set effect (Perilous Moons): with full set + Eclipse atlatl,
 * each landed hit has a 20% chance to inflict a burn dealing 10 damage over
 * 40 ticks (24s), capped at 5 simultaneous stacks per target.
 *
 * Steady-state stack count = procRate × burnDurationTicks / swingTicks
 *   = 0.20 × 40 / swingTicks = 8 / swingTicks (at acc=1)
 * Atlatl swings every 4t accurate / 3t rapid → max steady-state ≈ 2–2.67
 * stacks, well under the 5 cap. So in practice the cap never binds and the
 * model simplifies to:
 *
 *   avg burn damage per swing = accuracy × 0.20 × 10 = 2 × accuracy
 *
 * This is an additive damage contribution (burn ticks resolve independently
 * of the swing's own hit roll), so we add it to `avgHit` rather than scaling.
 * Wiki: https://oldschool.runescape.wiki/w/Eclipse_moon_armour
 */
const ECLIPSE_BURN_PROC = 0.20;
const ECLIPSE_BURN_TOTAL_DMG = 10;

export function isEclipseAtlatl(weapon: EquipmentPiece | null | undefined): boolean {
  return !!weapon && weapon.name === 'Eclipse atlatl';
}

function isEclipsePiece(piece: EquipmentPiece | null | undefined, slotName: string): boolean {
  if (!piece) return false;
  const want = `Eclipse moon ${slotName}`.toLowerCase();
  return piece.name.toLowerCase() === want;
}

export function isFullEclipseMoonSet(eq: {
  head?: EquipmentPiece | null;
  body?: EquipmentPiece | null;
  legs?: EquipmentPiece | null;
}): boolean {
  return (
    isEclipsePiece(eq.head, 'helm') &&
    isEclipsePiece(eq.body, 'chestplate') &&
    isEclipsePiece(eq.legs, 'tassets')
  );
}

export function eclipseMoonBurnAvgPerSwing(
  weapon: EquipmentPiece | null,
  accuracy: number,
  eq: { head?: EquipmentPiece | null; body?: EquipmentPiece | null; legs?: EquipmentPiece | null },
): number {
  if (!isEclipseAtlatl(weapon)) return 0;
  if (!isFullEclipseMoonSet(eq)) return 0;
  return accuracy * ECLIPSE_BURN_PROC * ECLIPSE_BURN_TOTAL_DMG;
}

/**
 * Name of the enchanted bolt proc that would fire for this weapon+ammo combo,
 * or null if none applies. Used by the effects-fired UI panel.
 */
export function boltProcName(
  weapon: EquipmentPiece | null,
  ammo: EquipmentPiece | null,
): string | null {
  if (!isCrossbow(weapon) || !ammo || !ENCHANTED_RE.test(ammo.name)) return null;
  const suffix = isZcb(weapon) ? ' (ZCB +10%)' : '';
  if (RUBY_BOLTS_RE.test(ammo.name)) return `Ruby bolt proc${suffix}`;
  if (DIAMOND_BOLTS_RE.test(ammo.name)) return `Diamond bolt proc${suffix}`;
  if (ONYX_BOLTS_RE.test(ammo.name)) return `Onyx bolt proc${suffix}`;
  if (DRAGONSTONE_BOLTS_RE.test(ammo.name)) return `Dragonstone bolt proc${suffix}`;
  return null;
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

  // Tomes give +10% damage on their matching element (post magic-rebalance).
  // Only Tome of water also gives accuracy (+20%); fire/earth give no accuracy.
  // Matches osrs-dps-calc (PlayerVsNPCCalc: dmg x11/10; water acc x6/5).
  if (shield && /^Tome of fire/i.test(shield.name) && spell.element === 'fire') {
    return { dmgMult: 1.1, accMult: 1 };
  }
  if (shield && /^Tome of water/i.test(shield.name) && spell.element === 'water') {
    return { dmgMult: 1.1, accMult: 1.2 };
  }
  if (shield && /^Tome of earth/i.test(shield.name) && spell.element === 'earth') {
    return { dmgMult: 1.1, accMult: 1 };
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
  // Ancient sceptre variants (Smoke / Shadow / Blood / Ice) — +10% dmg & acc
  // on matching-element ancient spells. Plain Ancient sceptre gives no spell
  // bonus (its perk is the ancient-spellbook autocast slot, which we don't
  // model since the spell selector already pins the cast).
  const element = ancientSpellElement(spell);
  if (element) {
    const expected = `${element[0].toUpperCase()}${element.slice(1)} ancient sceptre`;
    if (weapon.name === expected) return { dmgMult: 1.10, accMult: 1.10 };
  }

  return MAGIC_MULT_IDENTITY;
}

/**
 * Chaos gauntlets add a flat +3 to max hit on Bolt-class standard spells
 * (Wind/Water/Earth/Fire Bolt). Returns the additive bonus to apply to
 * `maxHit` in the magic branch — 0 when not applicable.
 */
export function chaosGauntletsBonus(
  hands: EquipmentPiece | null | undefined,
  spell: Spell | null,
): number {
  if (!hands || hands.name !== 'Chaos gauntlets') return 0;
  return isBoltSpell(spell) ? 3 : 0;
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
  // Scaling magic = max(Magic level, magic attack bonus), capped at 250 — or 350
  // for Xerician (Chambers of Xeric) monsters, the bow's signature content
  // (PlayerVsNPCCalc L596-599 / L778-781 + tbowScaling L2616-2625).
  const xerician = (monster.attributes || []).some((a) => a.toLowerCase() === 'xerician');
  const cap = xerician ? 350 : 250;
  const m = Math.min(cap, Math.max(monster.skills.magic, monster.offensive.magic));
  // trunc(3m/10) BEFORE squaring, and no output clamp — the formula is naturally
  // bounded by the magic cap, matching the wiki calc's tbowScaling verbatim.
  const t = Math.trunc((3 * m) / 10);
  const accPct = 140 + Math.trunc((3 * m - 10) / 100) - Math.trunc((t - 100) ** 2 / 100);
  const dmgPct = 250 + Math.trunc((3 * m - 14) / 100) - Math.trunc((t - 140) ** 2 / 100);
  return { dmgMult: dmgPct / 100, accMult: accPct / 100 };
}

// -------------------------------------------------------------------------
// Wilderness weapons — +50% acc & dmg while in the wilderness
// -------------------------------------------------------------------------

const WILDY_WEAPONS = new Set([
  "Craw's bow",
  'Webweaver bow',
  "Viggora's chainmace",
  'Ursine chainmace',
  "Thammaron's sceptre",
  'Accursed sceptre',
]);

/**
 * Ancient Wyvern wilderness weapons (+upgraded variants) gain +50% damage and
 * accuracy whenever the player is in the wilderness. Outside the wild they're
 * unremarkable.
 */
export function wildernessWeaponBonus(
  weapon: EquipmentPiece | null,
  inWilderness: boolean,
): { dmgMult: number; accMult: number } {
  if (!weapon || !inWilderness) return { dmgMult: 1, accMult: 1 };
  if (!WILDY_WEAPONS.has(weapon.name)) return { dmgMult: 1, accMult: 1 };
  return { dmgMult: 1.5, accMult: 1.5 };
}

// -------------------------------------------------------------------------
// Colossal blade — additive max-hit bonus scaled by target size
// -------------------------------------------------------------------------

/**
 * Colossal blade adds `min(size * 2, 10)` flat damage to max hit. Bigger
 * monsters → bigger bonus. Applies to melee and is additive (not a
 * multiplier), so returns a number to add to max hit before accuracy.
 */
export function colossalBladeBonus(
  weapon: EquipmentPiece | null,
  monster: Monster,
): number {
  if (!weapon || weapon.name !== 'Colossal blade') return 0;
  return Math.min(10, Math.max(1, monster.size) * 2);
}

// -------------------------------------------------------------------------
// Vampyre weapons — Blisterwood / Ivandis / Efaritay's aid
// -------------------------------------------------------------------------

function vampyreTier(monster: Monster): 0 | 1 | 2 | 3 {
  for (const a of monster.attributes || []) {
    const lc = a.toLowerCase();
    if (lc === 'vampyre1') return 1;
    if (lc === 'vampyre2') return 2;
    if (lc === 'vampyre3') return 3;
  }
  return 0;
}

const BLISTERWOOD_RE = /^Blisterwood (flail|sickle|staff)$/i;

/**
 * Vampyre-specific weapon bonuses vs tier 2/3 vampyres:
 *   - Blisterwood flail/sickle/staff: +25% damage, +5% accuracy (T2/T3).
 *   - Ivandis flail: +20% damage (T2 only).
 * Returns identity against non-vampyres or when the weapon doesn't qualify.
 */
export function vampyreWeaponBonus(
  weapon: EquipmentPiece | null,
  monster: Monster,
): { dmgMult: number; accMult: number } {
  const tier = vampyreTier(monster);
  if (!weapon || tier === 0) return { dmgMult: 1, accMult: 1 };
  if (BLISTERWOOD_RE.test(weapon.name) && tier >= 2) {
    return { dmgMult: 1.25, accMult: 1.05 };
  }
  if (weapon.name === 'Ivandis flail' && tier === 2) {
    return { dmgMult: 1.20, accMult: 1 };
  }
  return { dmgMult: 1, accMult: 1 };
}

/**
 * Efaritay's aid (worn in any slot that accepts it, typically ring) grants
 * +10% accuracy vs any tier of vampyre — stacks with vampyre weapons. No
 * damage effect.
 */
export function efaritayAccuracyBonus(
  eq: PlayerLoadout['equipment'],
  monster: Monster,
): number {
  if (vampyreTier(monster) === 0) return 1;
  // Efaritay's aid equips in unspecified slot; match by name across all slots.
  for (const piece of Object.values(eq)) {
    if (piece && piece.name === "Efaritay's aid") return 1.10;
  }
  return 1;
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
  // DHCB: +30% accuracy (×13/10) but only +25% damage (×5/4) — the wiki calc
  // applies ×5/4 to max hit (PlayerVsNPCCalc L788-790), not a symmetric +30%.
  if (weapon.name === 'Dragon hunter crossbow') return { dmgMult: 1.25, accMult: 1.30 };
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
    // Full magic void (regular OR elite) gives +45% magic accuracy — the wiki
    // calc applies ×29/20 to the effective level for any `isWearingMagicVoid`
    // (BaseCalc.isWearingMagicVoid, PlayerVsNPCCalc:862). The damage side is
    // NOT a trailing multiplier: the elite set instead adds a flat +5% magic
    // damage to the gear `magic_str` bonus *after* the Tumeken's-shadow triple
    // (Equipment.ts:428). That additive piece is handled by
    // `eliteVoidMageMagicStr` in the formula, so here damage is identity.
    return { dmgMult: 1, accMult: 1.45 };
  }
  return { dmgMult: 1, accMult: 1 };
}

/**
 * Ranged Void effective-LEVEL multipliers (ranger helm set). The wiki calc
 * scales the effective ranged ATTACK and STRENGTH levels — before the
 * `×(bonus+64)` step — rather than the final rolls, and truncates after each
 * (PlayerVsNPCCalc.getPlayerMaxRangedAttackRoll L570-572 + MaxHit L727-731):
 *   accuracy: ×11/10 for any ranged void (regular or elite)
 *   strength: ×11/10 regular, ×9/8 (i.e. +12.5%) elite
 * Applying these as trailing multipliers on the roll/max-hit (as a naive
 * `voidBonus`-style factor would) drifts by ±1 vs the game. Returns null when a
 * full ranged void set isn't worn; callers apply the factors with Math.trunc.
 */
export function rangedVoidLevelFactors(
  eq: PlayerLoadout['equipment'],
): { acc: [number, number]; str: [number, number]; tier: 'void' | 'elite' } | null {
  const set = detectVoidSet(eq);
  if (!set || set.helm !== 'ranger') return null;
  return { acc: [11, 10], str: set.tier === 'elite' ? [9, 8] : [11, 10], tier: set.tier };
}

/**
 * Elite Void mage full set adds a flat +5% magic damage, expressed in the
 * same tenths-of-a-percent units as `bonuses.magic_str` (i.e. +50). The wiki
 * calc adds this to the aggregate magic damage bonus *after* the Tumeken's
 * shadow ×3 multiplier and its 1000-cap, so it can push the total past +100%
 * (Equipment.ts:405-433). Returns 0 unless the full elite mage set is worn.
 */
export function eliteVoidMageMagicStr(eq: PlayerLoadout['equipment']): number {
  const set = detectVoidSet(eq);
  return set && set.helm === 'mage' && set.tier === 'elite' ? 50 : 0;
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

function isKalphiteOrScarab(monster: Monster): boolean {
  const attrs = (monster.attributes || []).map((a) => a.toLowerCase());
  return attrs.includes('kalphite') || attrs.includes('scarab');
}

/**
 * Keris family bonus vs kalphite/scarab attribute monsters. Matches the wiki
 * calc (PlayerVsNPCCalc:274-276 acc, 419-425 dmg, 1713-1719 proc):
 *   - ALL Keris variants: ×133/100 max hit — except Keris partisan of
 *     amascut, which gets ×115/100.
 *   - Keris partisan of breaching: also ×133/100 accuracy
 *     (https://twitter.com/JagexAsh/status/1704107285381787952).
 *   - All variants: 1/51 chance to deal triple damage. Expected avg damage
 *     multiplier on a hit = (50/51) + (1/51)*3 = 52/51 ≈ 1.0196.
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
  const dmgMult = weapon.name === 'Keris partisan of amascut' ? 1.15 : 1.33;
  const accMult = weapon.name === 'Keris partisan of breaching' ? 1.33 : 1;
  const avgDmgMult = 52 / 51;
  return { dmgMult, accMult, avgDmgMult };
}

/**
 * Keris partisan of the sun — inside Tombs of Amascut, gains +25% accuracy
 * vs targets below 25% HP. Applies to ALL targets in ToA (not just
 * kalphite/scarab — that's a separate Keris-family bonus already handled by
 * `kerisBonus`). Out-of-ToA the partisan doesn't get this passive.
 *
 * The DPS calc has no HP-state notion, so we model the kill-averaged effect:
 *   - 75% of HP-bar killed at base accuracy A1
 *   - 25% of HP-bar killed at A2 = min(1, A1 × 1.25)
 *   - kill time T = 0.75H/(A1·max/2·swing) + 0.25H/(A2·max/2·swing)
 *   - Effective accuracy A_eff = 1 / (0.75/A1 + 0.25/A2)
 *
 * Returns the multiplier `A_eff / A1` to scale `avgHit` by, or 1 when the
 * effect doesn't apply. When clamping doesn't bind (A1 ≤ 0.8) this gives
 * a flat ~+5.26% kill-averaged DPS; clamping erodes it as A1 climbs.
 * Wiki: https://oldschool.runescape.wiki/w/Keris_partisan_of_the_sun
 */
export function kerisSunAccBoostMult(
  weapon: EquipmentPiece | null,
  raidScaling: RaidScaling | undefined,
  baseAccuracy: number,
): number {
  if (!weapon || weapon.name !== 'Keris partisan of the sun') return 1;
  if (raidScaling?.kind !== 'toa') return 1;
  if (baseAccuracy <= 0) return 1;
  const boosted = Math.min(1, baseAccuracy * 1.25);
  const aEff = 1 / (0.75 / baseAccuracy + 0.25 / boosted);
  return aEff / baseAccuracy;
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
// Any Black mask / Slayer helmet variant — regular or imbued. The melee bonus
// does NOT need the imbue (isWearingBlackMask in the wiki calc); only the
// ranged/magic +15% is imbued-only (isWearingImbuedBlackMask).
const SLAYER_HELM_RE = /^Slayer helmet/i;
const BLACK_MASK_RE = /^Black mask/i;
const AVARICE_RE = /^Amulet of avarice/i;

/**
 * Salve amulet / Slayer helm / Black mask damage and accuracy bonuses.
 * Salve applies vs undead. Black mask / Slayer helmet (any variant) give the
 * melee 7/6 while `onSlayerTask` against an assignable monster; the imbued
 * (i) variants additionally give +15% to ranged and magic. Salve and slayer
 * helm DO NOT stack — Salve wins when both would apply. Returns identity
 * when nothing applies.
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

  // Amulet of avarice — +20% dmg & acc vs Revenants (melee/ranged multiplicative,
  // like salve). Magic avarice is handled additively in the magic branch of
  // calcDps, so it's excluded here. Mutually exclusive with salve/slayer.
  if (style !== 'magic' && neck && AVARICE_RE.test(neck.name) && monster.name.startsWith('Revenant')) {
    return { dmgMult: 1.2, accMult: 1.2 };
  }

  // The slayer bonus needs the monster to actually be assignable as a task
  // (isSlayerMonster in the wiki calc) — the on-task checkbox alone must not
  // buff unassignable targets like most raid bosses.
  if (loadout.onSlayerTask && monster.is_slayer_monster && head) {
    const anyMask = SLAYER_HELM_RE.test(head.name) || BLACK_MASK_RE.test(head.name);
    const imbued = SLAYER_HELM_I_RE.test(head.name) || BLACK_MASK_I_RE.test(head.name);
    if (style === 'melee' && anyMask) return { dmgMult: 7 / 6, accMult: 7 / 6 };
    if ((style === 'ranged' || style === 'magic') && imbued) return { dmgMult: 1.15, accMult: 1.15 };
  }

  return TARGET_IDENTITY;
}
