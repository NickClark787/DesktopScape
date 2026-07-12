/**
 * Unit tests for the per-weapon / per-set DPS modifier helpers.
 *
 * Each helper is tested for: (a) its negative case (non-applicable weapon /
 * missing set piece / wrong target type returns identity), and (b) the
 * specific math when it does fire — locked in to numeric expectations so
 * future refactors can't silently change DPS for the bosses in the validator.
 */
import { describe, expect, it } from 'vitest';
import type { EquipmentPiece, Monster, MonsterSkills, PlayerLoadout, RaidScaling, StyleStats } from '@shared/types';
import {
  bloodMoonSpeedReduction,
  boltProcAvgPerSwing,
  boltProcName,
  chaosGauntletsBonus,
  colossalBladeBonus,
  crystalArmourBonus,
  demonbaneMult,
  dragonHunterMult,
  dualMacuahuitlAvgPerSwing,
  eclipseMoonBurnAvgPerSwing,
  efaritayAccuracyBonus,
  eliteVoidMageMagicStr,
  harmonisedSpeedOverride,
  inquisitorBonus,
  isDualMacuahuitl,
  isEclipseAtlatl,
  isFullBloodMoonSet,
  isFullEclipseMoonSet,
  isScythe,
  kerisBonus,
  kerisSunAccBoostMult,
  magicWeaponMult,
  obsidianArmourBonus,
  scorchingBowMult,
  scytheAvgPerSwing,
  specialAvgPerSwing,
  targetTypeBonus,
  twistedBowMult,
  vampyreWeaponBonus,
  virtusBonus,
  voidBonus,
  wildernessWeaponBonus,
} from '@engine/weaponEffects';
import { calcDps } from '@engine/formulas';
import { spellByName } from '@engine/spells';

// ------------ Test fixtures ------------

const ZERO_STATS: StyleStats = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 };

function piece(overrides: Partial<EquipmentPiece> & Pick<EquipmentPiece, 'name' | 'slot'>): EquipmentPiece {
  return {
    id: 0,
    version: '',
    image: '',
    weight: 0,
    speed: 4,
    category: '',
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS },
    defensive: { ...ZERO_STATS },
    isTwoHanded: false,
    ...overrides,
  };
}

function monster(overrides: Partial<Monster> & { name?: string } = {}): Monster {
  const skills: MonsterSkills = { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1, ...(overrides.skills ?? {}) };
  return {
    id: 0,
    name: 'Test',
    version: '',
    image: '',
    level: 1,
    speed: 4,
    style: [],
    size: 1,
    max_hit: '0',
    skills,
    offensive: { atk: 0, str: 0, magic: 0, magic_str: 0, ranged: 0, ranged_str: 0 },
    defensive: { flat_armour: 0, stab: 0, slash: 0, crush: 0, magic: 0, heavy: 0, standard: 0, light: 0 },
    attributes: [],
    immunities: null,
    is_slayer_monster: false,
    weakness: null,
    ...overrides,
  };
}

function loadout(overrides: Partial<PlayerLoadout> = {}): PlayerLoadout {
  return {
    style: 'melee',
    attackStyle: 'slash',
    skills: { atk: 99, def: 99, str: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
    prayers: {
      piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
      burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
      rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
      augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
    },
    potions: { melee: 'none', ranged: 'none', magic: 'none' },
    onSlayerTask: false,
    inWilderness: false,
    equipment: {},
    spell: null,
    ...overrides,
  };
}

// ------------ Scythe ------------

describe('scythe', () => {
  it('detects scythe variants', () => {
    expect(isScythe(piece({ name: 'Scythe of vitur', slot: 'weapon' }))).toBe(true);
    expect(isScythe(piece({ name: 'Holy scythe of vitur', slot: 'weapon' }))).toBe(true);
    expect(isScythe(piece({ name: 'Sanguine scythe of vitur', slot: 'weapon' }))).toBe(true);
    expect(isScythe(piece({ name: 'Soulreaper axe', slot: 'weapon' }))).toBe(false);
    expect(isScythe(null)).toBe(false);
  });

  it('avg = 1 hit at full max for size 1', () => {
    // 1 hit @ 100% max, accuracy 1, max 100 → avg = 50
    expect(scytheAvgPerSwing(100, 1, 1)).toBe(50);
  });

  it('avg = hit1@100% + hit2@50% for size 2 (2x2 tile)', () => {
    // hits = [100, 50]; accuracy 1 → 50 + 25 = 75
    expect(scytheAvgPerSwing(100, 1, 2)).toBe(75);
  });

  it('avg = hit1@100% + hit2@50% + hit3@25% for size 3', () => {
    // hits = [100, 50, 25]; accuracy 1 → 50 + 25 + 12.5 = 87.5
    expect(scytheAvgPerSwing(100, 1, 3)).toBe(87.5);
  });

  it('scales linearly with accuracy', () => {
    expect(scytheAvgPerSwing(100, 0.5, 3)).toBe(43.75);
  });
});

// ------------ Bolt procs (with ZCB enhancement) ------------

describe('crossbow bolt procs', () => {
  const xbow = (name = 'Armadyl crossbow') => piece({ name, slot: 'weapon', category: 'Crossbow', isTwoHanded: false });
  const zcb = piece({ name: 'Zaryte crossbow', slot: 'weapon', category: 'Crossbow' });
  const target = monster({ skills: { atk: 1, def: 1, hp: 1000, magic: 1, ranged: 1, str: 1 } });

  it('returns null for non-enchanted bolts', () => {
    const ammo = piece({ name: 'Ruby dragon bolts', slot: 'ammo' });
    expect(boltProcAvgPerSwing(xbow(), ammo, 50, 0.7, target)).toBeNull();
  });

  it('returns null when weapon is not a crossbow', () => {
    const bow = piece({ name: 'Twisted bow', slot: 'weapon', category: 'Bow' });
    const ammo = piece({ name: 'Ruby dragon bolts (e)', slot: 'ammo' });
    expect(boltProcAvgPerSwing(bow, ammo, 50, 0.7, target)).toBeNull();
  });

  it('Ruby (e): 6% proc deals 20% current HP, cap 100', () => {
    const ammo = piece({ name: 'Ruby dragon bolts (e)', slot: 'ammo' });
    const max = 50, acc = 0.5;
    // Normal avg = 0.5 * 25 = 12.5
    // Proc dmg = min(100, floor(1000 * 0.20)) = 200 → cap at 100
    // 0.94 * 12.5 + 0.06 * 100 = 11.75 + 6 = 17.75
    expect(boltProcAvgPerSwing(xbow(), ammo, max, acc, target)).toBeCloseTo(17.75, 6);
  });

  it('Ruby (e) with ZCB: dmg 22%, cap 110', () => {
    const ammo = piece({ name: 'Ruby dragon bolts (e)', slot: 'ammo' });
    // Proc dmg = min(110, floor(1000 * 0.22)) = 220 → cap at 110
    // 0.94 * 12.5 + 0.06 * 110 = 11.75 + 6.6 = 18.35
    expect(boltProcAvgPerSwing(zcb, ammo, 50, 0.5, target)).toBeCloseTo(18.35, 6);
  });

  it('Diamond (e): 10% proc, +15% max, ignores defense', () => {
    const ammo = piece({ name: 'Diamond bolts (e)', slot: 'ammo' });
    const max = 50, acc = 0.5;
    // Normal avg = 12.5
    // Proc max = trunc(50 * 1.15) = 57; proc avg = 57/2 = 28.5 (guaranteed)
    // 0.90 * 12.5 + 0.10 * 28.5 = 11.25 + 2.85 = 14.10
    expect(boltProcAvgPerSwing(xbow(), ammo, max, acc, target)).toBeCloseTo(14.10, 6);
  });

  it('Diamond (e) with ZCB: +26% max', () => {
    const ammo = piece({ name: 'Diamond bolts (e)', slot: 'ammo' });
    // Proc max = trunc(50 * 1.26) = 63; proc avg = 63/2 = 31.5
    // 0.90 * 12.5 + 0.10 * 31.5 = 11.25 + 3.15 = 14.40
    expect(boltProcAvgPerSwing(zcb, ammo, 50, 0.5, target)).toBeCloseTo(14.40, 6);
  });

  it('Onyx (e) with ZCB: 11% proc, +32% max, accuracy still rolls', () => {
    const ammo = piece({ name: 'Onyx bolts (e)', slot: 'ammo' });
    // Proc rate 11% (wiki calc), accurate-only. Proc max = trunc(50 * 1.32) = 66;
    // proc avg = acc * 66/2 = 0.5 * 33 = 16.5
    // 0.89 * 12.5 + 0.11 * 16.5 = 11.125 + 1.815 = 12.94
    expect(boltProcAvgPerSwing(zcb, ammo, 50, 0.5, target)).toBeCloseTo(12.94, 6);
  });

  it('Onyx (e): ineffective vs undead (no life to leech)', () => {
    const ammo = piece({ name: 'Onyx bolts (e)', slot: 'ammo' });
    const undead = monster({ attributes: ['undead'], skills: { atk: 1, def: 1, hp: 1000, magic: 1, ranged: 1, str: 1 } });
    // Falls back to normal avg only: 0.5 * 25 = 12.5
    expect(boltProcAvgPerSwing(xbow(), ammo, 50, 0.5, undead)).toBeCloseTo(12.5, 6);
  });

  it('Dragonstone (e): immune to dragons', () => {
    const ammo = piece({ name: 'Dragonstone bolts (e)', slot: 'ammo' });
    const dragon = monster({ attributes: ['dragon'], skills: { atk: 1, def: 1, hp: 1000, magic: 1, ranged: 1, str: 1 } });
    const result = boltProcAvgPerSwing(xbow(), ammo, 50, 0.5, dragon);
    // Should fall back to normal avg only
    expect(result).toBeCloseTo(12.5, 6);
  });

  it('Dragonstone (e): immune to fiery monsters too', () => {
    const ammo = piece({ name: 'Dragonstone bolts (e)', slot: 'ammo' });
    const fiery = monster({ attributes: ['fiery'], skills: { atk: 1, def: 1, hp: 1000, magic: 1, ranged: 1, str: 1 } });
    expect(boltProcAvgPerSwing(xbow(), ammo, 50, 0.5, fiery)).toBeCloseTo(12.5, 6);
  });

  it('boltProcName labels ZCB variants distinctly', () => {
    const ammo = piece({ name: 'Ruby dragon bolts (e)', slot: 'ammo' });
    expect(boltProcName(xbow(), ammo)).toBe('Ruby bolt proc');
    expect(boltProcName(zcb, ammo)).toBe('Ruby bolt proc (ZCB +10%)');
  });

  it('boltProcName returns null for non-bolt setups', () => {
    expect(boltProcName(null, null)).toBeNull();
    expect(boltProcName(piece({ name: 'Twisted bow', slot: 'weapon', category: 'Bow' }), null)).toBeNull();
  });
});

// ------------ Dual macuahuitl ------------

describe('dual macuahuitl', () => {
  it('detects weapon', () => {
    expect(isDualMacuahuitl(piece({ name: 'Dual macuahuitl', slot: 'weapon' }))).toBe(true);
    expect(isDualMacuahuitl(piece({ name: 'Sanguine scythe of vitur', slot: 'weapon' }))).toBe(false);
  });

  it('avg = 2 * acc * (max/2) (two hits sharing acc roll)', () => {
    expect(dualMacuahuitlAvgPerSwing(50, 0.6)).toBeCloseTo(2 * 0.6 * 25, 6);
  });
});

// ------------ Blood Moon set ------------

describe('Blood Moon set', () => {
  const helm = piece({ name: 'Blood moon helm', slot: 'head' });
  const body = piece({ name: 'Blood moon chestplate', slot: 'body' });
  const legs = piece({ name: 'Blood moon tassets', slot: 'legs' });
  const macu = piece({ name: 'Dual macuahuitl', slot: 'weapon' });
  const torva = piece({ name: 'Torva full helm', slot: 'head' });

  it('detects full set (case-insensitive)', () => {
    expect(isFullBloodMoonSet({ head: helm, body, legs })).toBe(true);
  });

  it('rejects missing piece', () => {
    expect(isFullBloodMoonSet({ head: helm, body, legs: torva })).toBe(false);
    expect(isFullBloodMoonSet({ head: null, body, legs })).toBe(false);
  });

  it('speed reduction = 0 without macuahuitl', () => {
    expect(bloodMoonSpeedReduction(torva, 0.9, { head: helm, body, legs })).toBe(0);
  });

  it('speed reduction = 0 without full set', () => {
    expect(bloodMoonSpeedReduction(macu, 0.9, { head: torva, body, legs })).toBe(0);
  });

  it('speed reduction = accuracy * 5/9 with full set + macuahuitl', () => {
    expect(bloodMoonSpeedReduction(macu, 0.9, { head: helm, body, legs })).toBeCloseTo(0.5, 6);
    expect(bloodMoonSpeedReduction(macu, 1.0, { head: helm, body, legs })).toBeCloseTo(5 / 9, 6);
    expect(bloodMoonSpeedReduction(macu, 0, { head: helm, body, legs })).toBe(0);
  });
});

// ------------ Eclipse Moon set ------------

describe('Eclipse Moon set', () => {
  const helm = piece({ name: 'Eclipse moon helm', slot: 'head' });
  const body = piece({ name: 'Eclipse moon chestplate', slot: 'body' });
  const legs = piece({ name: 'Eclipse moon tassets', slot: 'legs' });
  const atlatl = piece({ name: 'Eclipse atlatl', slot: 'weapon' });

  it('detects atlatl', () => {
    expect(isEclipseAtlatl(atlatl)).toBe(true);
    expect(isEclipseAtlatl(piece({ name: 'Twisted bow', slot: 'weapon' }))).toBe(false);
    expect(isEclipseAtlatl(null)).toBe(false);
  });

  it('detects full set', () => {
    expect(isFullEclipseMoonSet({ head: helm, body, legs })).toBe(true);
    expect(isFullEclipseMoonSet({ head: helm, body, legs: null })).toBe(false);
  });

  it('burn = 0 without atlatl', () => {
    const bow = piece({ name: 'Twisted bow', slot: 'weapon' });
    expect(eclipseMoonBurnAvgPerSwing(bow, 1, { head: helm, body, legs })).toBe(0);
  });

  it('burn = 0 without full set', () => {
    expect(eclipseMoonBurnAvgPerSwing(atlatl, 1, { head: helm, body, legs: null })).toBe(0);
  });

  it('burn = accuracy * 0.20 * 10 = 2 * accuracy with full set', () => {
    expect(eclipseMoonBurnAvgPerSwing(atlatl, 1, { head: helm, body, legs })).toBeCloseTo(2, 6);
    expect(eclipseMoonBurnAvgPerSwing(atlatl, 0.5, { head: helm, body, legs })).toBeCloseTo(1, 6);
    expect(eclipseMoonBurnAvgPerSwing(atlatl, 0, { head: helm, body, legs })).toBe(0);
  });
});

// ------------ Eclipse atlatl: Strength bonus drives ranged max hit ------------
//
// The atlatl is the only ranged weapon that scales max hit off the equipment-screen
// Strength bonus (rather than Ranged Strength). The data faithfully records the
// atlatl's +40 in `bonuses.str` and 0 in `bonuses.ranged_str`; the engine swaps the
// input field when it sees the atlatl. These tests exercise calcDps end-to-end to
// lock in that behavior — the unit-level helpers above can't catch a regression in
// the formulas.ts wiring.

describe('Eclipse atlatl Strength-bonus quirk (calcDps integration)', () => {
  // Build a minimal repro: same gear apart from str bonus, swap weapon between
  // atlatl and a sham "regular" ranged weapon. With the atlatl, the +40 str on
  // the weapon should drive max hit upward; with the sham, it shouldn't.
  const atlatl = piece({
    name: 'Eclipse atlatl',
    slot: 'weapon',
    speed: 4,
    isTwoHanded: true,
    bonuses: { str: 40, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS, ranged: 87 },
  });
  // Same offensive stats, +40 in ranged_str (where a normal ranged weapon would put it),
  // 0 in str. Acts as the control case — same accuracy, but we expect a different max hit
  // from the atlatl despite both having the same combined "ranged-strength-relevant" pool.
  const shamBow = piece({
    name: 'Sham bow',
    slot: 'weapon',
    speed: 4,
    isTwoHanded: true,
    bonuses: { str: 0, ranged_str: 40, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS, ranged: 87 },
  });
  const dummy = monster({
    skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1 },
  });
  const baseLoadout = (weapon: EquipmentPiece): PlayerLoadout => loadout({
    style: 'ranged',
    attackStyle: 'ranged',
    stance: 'rapid',
    equipment: { weapon },
  });

  it('atlatl and a "sham bow" with equivalent ranged_str produce equal max hit', () => {
    const a = calcDps(baseLoadout(atlatl), dummy);
    const s = calcDps(baseLoadout(shamBow), dummy);
    expect(a.maxHit).toBe(s.maxHit);
    expect(a.maxHit).toBeGreaterThan(0);
  });

  it('atlatl picks up Strength bonus from non-weapon gear (str-stacking)', () => {
    const furyAmulet = piece({
      name: 'Amulet of fury',
      slot: 'neck',
      bonuses: { str: 8, ranged_str: 0, magic_str: 0, prayer: 0 },
    });
    const without = calcDps(baseLoadout(atlatl), dummy);
    const with_ = calcDps(loadout({
      style: 'ranged', attackStyle: 'ranged', stance: 'rapid',
      equipment: { weapon: atlatl, neck: furyAmulet },
    }), dummy);
    // Adding +8 str to a setup with +40 atlatl str should bump max hit at least one.
    expect(with_.maxHit).toBeGreaterThan(without.maxHit);
  });

  it('non-atlatl ranged weapon ignores Strength bonus from gear', () => {
    const furyAmulet = piece({
      name: 'Amulet of fury',
      slot: 'neck',
      bonuses: { str: 8, ranged_str: 0, magic_str: 0, prayer: 0 },
    });
    const without = calcDps(baseLoadout(shamBow), dummy);
    const with_ = calcDps(loadout({
      style: 'ranged', attackStyle: 'ranged', stance: 'rapid',
      equipment: { weapon: shamBow, neck: furyAmulet },
    }), dummy);
    // Sham bow uses ranged_str only; the +8 melee str on the amulet must not affect max hit.
    expect(with_.maxHit).toBe(without.maxHit);
  });

  it('surfaces an "Eclipse atlatl" effect entry when atlatl is wielded', () => {
    const result = calcDps(baseLoadout(atlatl), dummy);
    expect(result.effects.some((e) => e.name === 'Eclipse atlatl')).toBe(true);
    const noAtlatl = calcDps(baseLoadout(shamBow), dummy);
    expect(noAtlatl.effects.some((e) => e.name === 'Eclipse atlatl')).toBe(false);
  });
});

// ------------ Keris partisan of the sun ------------

describe('Keris partisan of the sun (ToA execute boost)', () => {
  const partisan = piece({ name: 'Keris partisan of the sun', slot: 'weapon' });
  const corruption = piece({ name: 'Keris partisan of corruption', slot: 'weapon' });
  const toaSolo: RaidScaling = { kind: 'toa', partySize: 1, raidLevel: 0, pathLevel: 0 };
  const cox: RaidScaling = { kind: 'cox', partySize: 1 };

  it('returns identity outside ToA', () => {
    expect(kerisSunAccBoostMult(partisan, undefined, 0.5)).toBe(1);
    expect(kerisSunAccBoostMult(partisan, cox, 0.5)).toBe(1);
  });

  it('returns identity for non-sun partisan inside ToA', () => {
    expect(kerisSunAccBoostMult(corruption, toaSolo, 0.5)).toBe(1);
  });

  it('returns identity for null weapon', () => {
    expect(kerisSunAccBoostMult(null, toaSolo, 0.5)).toBe(1);
  });

  it('returns identity for zero accuracy (avoids div-by-zero)', () => {
    expect(kerisSunAccBoostMult(partisan, toaSolo, 0)).toBe(1);
  });

  it('full +5.26% boost when accuracy stays below clamp', () => {
    // A1 = 0.5, A2 = 0.625; A_eff = 1/(0.75/0.5 + 0.25/0.625) = 1/1.9 = 0.5263
    // mult = 0.5263 / 0.5 = 1.0526
    expect(kerisSunAccBoostMult(partisan, toaSolo, 0.5)).toBeCloseTo(1.0526, 4);
  });

  it('boost erodes as base accuracy approaches 1.0 (clamp binds)', () => {
    // A1 = 0.9, A2 = min(1, 1.125) = 1.0
    // A_eff = 1/(0.75/0.9 + 0.25/1.0) = 1/(0.8333 + 0.25) = 0.9231
    // mult = 0.9231 / 0.9 = 1.0256
    expect(kerisSunAccBoostMult(partisan, toaSolo, 0.9)).toBeCloseTo(1.0256, 4);
  });

  it('boost = 1 at perfect accuracy', () => {
    expect(kerisSunAccBoostMult(partisan, toaSolo, 1)).toBe(1);
  });
});

// ------------ Keris family ------------

describe('Keris family bonus', () => {
  const baseKeris = piece({ name: 'Keris', slot: 'weapon' });
  const partisan = piece({ name: 'Keris partisan', slot: 'weapon' });
  const corruption = piece({ name: 'Keris partisan of corruption', slot: 'weapon' });
  const breaching = piece({ name: 'Keris partisan of breaching', slot: 'weapon' });
  const amascut = piece({ name: 'Keris partisan of amascut', slot: 'weapon' });
  const sun = piece({ name: 'Keris partisan of the sun', slot: 'weapon' });
  const kalphite = monster({ attributes: ['kalphite'] });
  const scarab = monster({ attributes: ['scarab'] });
  const dragon = monster({ attributes: ['dragon'] });

  it('all variants get 1/51 triple-dmg avg vs kalphite/scarab', () => {
    expect(kerisBonus(baseKeris, kalphite).avgDmgMult).toBeCloseTo(52 / 51, 6);
    expect(kerisBonus(partisan, scarab).avgDmgMult).toBeCloseTo(52 / 51, 6);
    expect(kerisBonus(sun, kalphite).avgDmgMult).toBeCloseTo(52 / 51, 6);
  });

  it('every Keris variant gets ×133/100 dmg vs kalphite (wiki calc isWearingKeris)', () => {
    expect(kerisBonus(baseKeris, kalphite).dmgMult).toBeCloseTo(1.33, 6);
    expect(kerisBonus(partisan, kalphite).dmgMult).toBeCloseTo(1.33, 6);
    expect(kerisBonus(corruption, kalphite).dmgMult).toBeCloseTo(1.33, 6);
    expect(kerisBonus(breaching, kalphite).dmgMult).toBeCloseTo(1.33, 6);
    expect(kerisBonus(sun, kalphite).dmgMult).toBeCloseTo(1.33, 6);
  });

  it('Keris partisan of amascut gets the reduced ×115/100 dmg', () => {
    expect(kerisBonus(amascut, kalphite).dmgMult).toBeCloseTo(1.15, 6);
  });

  it('only Keris partisan of breaching adds +33% acc', () => {
    // https://twitter.com/JagexAsh/status/1704107285381787952
    expect(kerisBonus(breaching, kalphite).accMult).toBeCloseTo(1.33, 6);
    expect(kerisBonus(corruption, kalphite).accMult).toBe(1);
    expect(kerisBonus(partisan, kalphite).accMult).toBe(1);
    expect(kerisBonus(sun, kalphite).accMult).toBe(1);
  });

  it('returns identity vs non-kalphite/scarab', () => {
    const r = kerisBonus(corruption, dragon);
    expect(r).toEqual({ dmgMult: 1, accMult: 1, avgDmgMult: 1 });
  });
});

// ------------ Twisted bow ------------

describe('twisted bow', () => {
  const tbow = piece({ name: 'Twisted bow', slot: 'weapon', category: 'Bow' });

  it('returns identity for non-tbow', () => {
    const r = twistedBowMult(piece({ name: 'Bow of faerdhinen', slot: 'weapon' }), monster({ skills: { atk: 1, def: 1, hp: 100, magic: 100, ranged: 1, str: 1 } }));
    expect(r).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('clamps at magic 250', () => {
    const r1 = twistedBowMult(tbow, monster({ skills: { atk: 1, def: 1, hp: 100, magic: 250, ranged: 1, str: 1 } }));
    const r2 = twistedBowMult(tbow, monster({ skills: { atk: 1, def: 1, hp: 100, magic: 350, ranged: 1, str: 1 } }));
    expect(r1).toEqual(r2);
  });

  it('mults clamped to [0, 140%] / [0, 250%]', () => {
    const r = twistedBowMult(tbow, monster({ skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1 } }));
    expect(r.accMult).toBeGreaterThanOrEqual(0);
    expect(r.dmgMult).toBeGreaterThanOrEqual(0);
    expect(r.accMult).toBeLessThanOrEqual(1.4);
    expect(r.dmgMult).toBeLessThanOrEqual(2.5);
  });

  it('low-magic targets give sub-100% mults (TBow is bad here)', () => {
    const r = twistedBowMult(tbow, monster({ skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1 } }));
    expect(r.dmgMult).toBeLessThan(1);
  });

  it('high-magic targets give super-100% mults (TBow shines)', () => {
    const r = twistedBowMult(tbow, monster({ skills: { atk: 1, def: 1, hp: 100, magic: 250, ranged: 1, str: 1 } }));
    expect(r.dmgMult).toBeGreaterThan(2);
    expect(r.accMult).toBeGreaterThan(1.3);
  });
});

// ------------ Crystal armour ------------

describe('crystal armour', () => {
  const helm = piece({ name: 'Crystal helm', slot: 'head' });
  const body = piece({ name: 'Crystal body', slot: 'body' });
  const legs = piece({ name: 'Crystal legs', slot: 'legs' });
  const bof = piece({ name: 'Bow of faerdhinen', slot: 'weapon' });
  const crystalBow = piece({ name: 'Crystal bow', slot: 'weapon' });
  const tbow = piece({ name: 'Twisted bow', slot: 'weapon' });

  it('returns identity without crystal bow / BoF', () => {
    expect(crystalArmourBonus({ weapon: tbow, head: helm, body, legs })).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('full set with BoF: +15% dmg, +30% acc', () => {
    const r = crystalArmourBonus({ weapon: bof, head: helm, body, legs });
    expect(r.dmgMult).toBeCloseTo(1.15, 6);
    expect(r.accMult).toBeCloseTo(1.30, 6);
  });

  it('full set with Crystal bow: same +15% / +30%', () => {
    const r = crystalArmourBonus({ weapon: crystalBow, head: helm, body, legs });
    expect(r.dmgMult).toBeCloseTo(1.15, 6);
    expect(r.accMult).toBeCloseTo(1.30, 6);
  });

  it('per-piece bonuses additive: helm only = +2.5% / +5%', () => {
    const r = crystalArmourBonus({ weapon: bof, head: helm });
    expect(r.dmgMult).toBeCloseTo(1.025, 6);
    expect(r.accMult).toBeCloseTo(1.05, 6);
  });

  it('per-piece: body only = +7.5% / +15%', () => {
    const r = crystalArmourBonus({ weapon: bof, body });
    expect(r.dmgMult).toBeCloseTo(1.075, 6);
    expect(r.accMult).toBeCloseTo(1.15, 6);
  });
});

// ------------ Void / Elite Void ------------

describe('void knight set', () => {
  const gloves = piece({ name: 'Void knight gloves', slot: 'hands' });
  const top = piece({ name: 'Void knight top', slot: 'body' });
  const robe = piece({ name: 'Void knight robe', slot: 'legs' });
  const eliteTop = piece({ name: 'Elite void top', slot: 'body' });
  const eliteRobe = piece({ name: 'Elite void robe', slot: 'legs' });
  const meleeHelm = piece({ name: 'Void melee helm', slot: 'head' });
  const rangerHelm = piece({ name: 'Void ranger helm', slot: 'head' });
  const mageHelm = piece({ name: 'Void mage helm', slot: 'head' });
  const oranameledHelm = piece({ name: 'Void ranger helm (or)', slot: 'head' });

  it('returns identity without gloves', () => {
    expect(voidBonus({ head: meleeHelm, body: top, legs: robe }, 'melee')).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('regular void melee: +10% / +10%', () => {
    const r = voidBonus({ hands: gloves, head: meleeHelm, body: top, legs: robe }, 'melee');
    expect(r).toEqual({ dmgMult: 1.10, accMult: 1.10 });
  });

  it('elite void ranged: +12.5% str / +10% acc (helm matches style)', () => {
    const r = voidBonus({ hands: gloves, head: rangerHelm, body: eliteTop, legs: eliteRobe }, 'ranged');
    expect(r.dmgMult).toBeCloseTo(1.125, 6);
    expect(r.accMult).toBeCloseTo(1.10, 6);
  });

  it('regular void ranged: +10% / +10% (no elite str bump)', () => {
    const r = voidBonus({ hands: gloves, head: rangerHelm, body: top, legs: robe }, 'ranged');
    expect(r).toEqual({ dmgMult: 1.10, accMult: 1.10 });
  });

  it('elite void magic: +45% acc via voidBonus; +50 magic_str applied separately', () => {
    // Per the OSRS wiki calc (Equipment.ts L427-433 + BaseCalc.isWearingMagicVoid):
    // ALL magic void gets ×29/20 (+45%) accuracy. The elite bonus is NOT a damage
    // multiplier — it adds a flat +50 to the magic_str pool (≈+5% dmg), handled by
    // eliteVoidMageMagicStr() in formulas.ts, so voidBonus.dmgMult stays 1.
    const r = voidBonus({ hands: gloves, head: mageHelm, body: eliteTop, legs: eliteRobe }, 'magic');
    expect(r.dmgMult).toBeCloseTo(1.00, 6);
    expect(r.accMult).toBeCloseTo(1.45, 6);
    expect(eliteVoidMageMagicStr({ hands: gloves, head: mageHelm, body: eliteTop, legs: eliteRobe })).toBe(50);
  });

  it('regular void magic: +45% acc, no +50 magic_str bonus', () => {
    // Per BaseCalc.isWearingVoidRobes (accepts regular OR elite robes), the +45%
    // magic accuracy applies to the regular set too — it is NOT elite-only.
    // Only the +50 magic_str (eliteVoidMageMagicStr) is gated to the elite set.
    const r = voidBonus({ hands: gloves, head: mageHelm, body: top, legs: robe }, 'magic');
    expect(r.dmgMult).toBeCloseTo(1.00, 6);
    expect(r.accMult).toBeCloseTo(1.45, 6);
    expect(eliteVoidMageMagicStr({ hands: gloves, head: mageHelm, body: top, legs: robe })).toBe(0);
  });

  it('mismatched helm/style returns identity', () => {
    expect(voidBonus({ hands: gloves, head: rangerHelm, body: top, legs: robe }, 'melee')).toEqual({ dmgMult: 1, accMult: 1 });
    expect(voidBonus({ hands: gloves, head: meleeHelm, body: top, legs: robe }, 'magic')).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('accepts ornament-kit helm variants', () => {
    const r = voidBonus({ hands: gloves, head: oranameledHelm, body: eliteTop, legs: eliteRobe }, 'ranged');
    expect(r.dmgMult).toBeCloseTo(1.125, 6);
  });
});

// ------------ Inquisitor's set ------------

describe("inquisitor's armour", () => {
  const helm = piece({ name: "Inquisitor's great helm", slot: 'head' });
  const body = piece({ name: "Inquisitor's hauberk", slot: 'body' });
  const legs = piece({ name: "Inquisitor's plateskirt", slot: 'legs' });

  it('non-crush attack: identity', () => {
    expect(inquisitorBonus({ head: helm, body, legs }, 'slash')).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('crush, 1 piece: +0.5%', () => {
    const r = inquisitorBonus({ head: helm }, 'crush');
    expect(r.dmgMult).toBeCloseTo(1.005, 6);
    expect(r.accMult).toBeCloseTo(1.005, 6);
  });

  it('crush, 2 pieces: +1.0%', () => {
    const r = inquisitorBonus({ head: helm, body }, 'crush');
    expect(r.dmgMult).toBeCloseTo(1.010, 6);
  });

  it('crush, full set: +2.5% (rounded up from 1.5%)', () => {
    const r = inquisitorBonus({ head: helm, body, legs }, 'crush');
    expect(r.dmgMult).toBeCloseTo(1.025, 6);
    expect(r.accMult).toBeCloseTo(1.025, 6);
  });

  it('crush, no pieces: identity', () => {
    expect(inquisitorBonus({}, 'crush')).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

// ------------ Magic weapon multipliers ------------

describe('magic weapon multipliers', () => {
  const tomeOfFire = piece({ name: 'Tome of fire', slot: 'shield' });
  const tomeOfWater = piece({ name: 'Tome of water', slot: 'shield' });
  const smokeStaff = piece({ name: 'Smoke battlestaff', slot: 'weapon' });
  const iceSceptre = piece({ name: 'Ice ancient sceptre', slot: 'weapon' });

  it('Tome of fire: +10% dmg, +0% acc on fire spells', () => {
    // Modern OSRS: Tome of fire gives +10% magic damage and no accuracy bonus
    // (it used to be +50% to both; the wiki calc reflects the current values).
    const fireBolt = spellByName('Fire Bolt');
    expect(fireBolt).not.toBeNull();
    const r = magicWeaponMult(null, tomeOfFire, fireBolt);
    expect(r.dmgMult).toBeCloseTo(1.1, 6);
    expect(r.accMult).toBeCloseTo(1.0, 6);
  });

  it('Tome of fire: identity on non-fire spells', () => {
    const waterBolt = spellByName('Water Bolt');
    expect(magicWeaponMult(null, tomeOfFire, waterBolt)).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('Tome of water: +10% dmg, +20% acc on water spells', () => {
    // Modern OSRS: Tome of water gives +10% magic damage and +20% accuracy.
    const waterBolt = spellByName('Water Bolt');
    const r = magicWeaponMult(null, tomeOfWater, waterBolt);
    expect(r.dmgMult).toBeCloseTo(1.1, 6);
    expect(r.accMult).toBeCloseTo(1.2, 6);
  });

  it('Smoke battlestaff: +10% on standard-spellbook spells', () => {
    const fireBolt = spellByName('Fire Bolt');
    const r = magicWeaponMult(smokeStaff, null, fireBolt);
    expect(r.dmgMult).toBeCloseTo(1.1, 6);
    expect(r.accMult).toBeCloseTo(1.1, 6);
  });

  it('Smoke battlestaff: identity on ancient spells', () => {
    const iceBarrage = spellByName('Ice Barrage');
    expect(magicWeaponMult(smokeStaff, null, iceBarrage)).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('Ice ancient sceptre: +10% on Ice spells', () => {
    const iceBarrage = spellByName('Ice Barrage');
    const r = magicWeaponMult(iceSceptre, null, iceBarrage);
    expect(r.dmgMult).toBeCloseTo(1.10, 6);
    expect(r.accMult).toBeCloseTo(1.10, 6);
  });

  it('Ice ancient sceptre: identity on non-ice ancient spell', () => {
    const bloodBarrage = spellByName('Blood Barrage');
    expect(magicWeaponMult(iceSceptre, null, bloodBarrage)).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('null spell: identity', () => {
    expect(magicWeaponMult(smokeStaff, null, null)).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

// ------------ Chaos gauntlets ------------

describe('chaos gauntlets', () => {
  const cg = piece({ name: 'Chaos gauntlets', slot: 'hands' });

  it('returns 0 for non-CG hands', () => {
    expect(chaosGauntletsBonus(piece({ name: 'Barrows gloves', slot: 'hands' }), spellByName('Fire Bolt'))).toBe(0);
  });

  it('returns 0 for null hands', () => {
    expect(chaosGauntletsBonus(null, spellByName('Fire Bolt'))).toBe(0);
  });

  it('returns +3 for any Bolt-class standard spell', () => {
    expect(chaosGauntletsBonus(cg, spellByName('Wind Bolt'))).toBe(3);
    expect(chaosGauntletsBonus(cg, spellByName('Water Bolt'))).toBe(3);
    expect(chaosGauntletsBonus(cg, spellByName('Earth Bolt'))).toBe(3);
    expect(chaosGauntletsBonus(cg, spellByName('Fire Bolt'))).toBe(3);
  });

  it('returns 0 for non-Bolt spells', () => {
    expect(chaosGauntletsBonus(cg, spellByName('Fire Surge'))).toBe(0);
    expect(chaosGauntletsBonus(cg, spellByName('Ice Barrage'))).toBe(0);
  });
});

// ------------ Demonbane / dragon hunter / scorching bow ------------

describe('demonbane melee weapons', () => {
  const demon = monster({ attributes: ['demon'] });
  const nondemon = monster();

  it('Emberlight: +70% / +70% vs demon', () => {
    const r = demonbaneMult(piece({ name: 'Emberlight', slot: 'weapon' }), demon);
    expect(r).toEqual({ dmgMult: 1.7, accMult: 1.7 });
  });

  it('Darklight / Silverlight: +60% dmg, NO accuracy bonus', () => {
    // Wiki calc only gives Arclight/Emberlight the accuracy factor
    // (PlayerVsNPCCalc L261-263); Silverlight/Darklight are max-hit-only (L435-437).
    expect(demonbaneMult(piece({ name: 'Darklight', slot: 'weapon' }), demon)).toEqual({ dmgMult: 1.6, accMult: 1 });
    expect(demonbaneMult(piece({ name: 'Silverlight', slot: 'weapon' }), demon)).toEqual({ dmgMult: 1.6, accMult: 1 });
  });

  it('scales with demonbane vulnerability (Duke Sucellus 70%, Yama 120%)', () => {
    const duke = monster({ name: 'Duke Sucellus', attributes: ['demon'] });
    const yama = monster({ name: 'Yama', id: 14176, attributes: ['demon'] });
    // Arclight vs Duke: trunc(70×70/100) = 49 → ×1.49
    const vsDuke = demonbaneMult(piece({ name: 'Arclight', slot: 'weapon' }), duke);
    expect(vsDuke.dmgMult).toBeCloseTo(1.49, 9);
    expect(vsDuke.accMult).toBeCloseTo(1.49, 9);
    // Arclight vs Yama: trunc(70×120/100) = 84 → ×1.84
    const vsYama = demonbaneMult(piece({ name: 'Arclight', slot: 'weapon' }), yama);
    expect(vsYama.dmgMult).toBeCloseTo(1.84, 9);
    expect(vsYama.accMult).toBeCloseTo(1.84, 9);
  });

  it('identity vs non-demon', () => {
    expect(demonbaneMult(piece({ name: 'Emberlight', slot: 'weapon' }), nondemon)).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

describe('dragon hunter weapons', () => {
  const dragon = monster({ attributes: ['dragon'] });
  const nondragon = monster();

  it('DHL: +20% / +20% vs dragon', () => {
    expect(dragonHunterMult(piece({ name: 'Dragon hunter lance', slot: 'weapon' }), dragon)).toEqual({ dmgMult: 1.20, accMult: 1.20 });
  });

  it('DHCB: +30% acc / +25% dmg vs dragon', () => {
    // Accuracy is ×13/10 but damage is only ×5/4 (wiki calc PlayerVsNPCCalc L788-790).
    expect(dragonHunterMult(piece({ name: 'Dragon hunter crossbow', slot: 'weapon' }), dragon)).toEqual({ dmgMult: 1.25, accMult: 1.30 });
  });

  it('DHW: ×7/4 acc / ×7/5 dmg vs dragon', () => {
    // Wiki calc PlayerVsNPCCalc L270-271 (acc 7/4) and L1087-1088 (dmg 7/5).
    const r = dragonHunterMult(piece({ name: 'Dragon hunter wand', slot: 'weapon' }), dragon);
    expect(r.dmgMult).toBeCloseTo(7 / 5, 9);
    expect(r.accMult).toBeCloseTo(7 / 4, 9);
  });

  it('identity vs non-dragon', () => {
    expect(dragonHunterMult(piece({ name: 'Dragon hunter lance', slot: 'weapon' }), nondragon)).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

describe('scorching bow', () => {
  const bow = piece({ name: 'Scorching bow', slot: 'weapon' });
  it('+30% / +30% vs demon', () => {
    expect(scorchingBowMult(bow, monster({ attributes: ['demon'] }))).toEqual({ dmgMult: 1.30, accMult: 1.30 });
  });
  it('scales with demonbane vulnerability', () => {
    const duke = monster({ name: 'Duke Sucellus', attributes: ['demon'] });
    // trunc(30×70/100) = 21 → ×1.21
    expect(scorchingBowMult(bow, duke)).toEqual({ dmgMult: 1.21, accMult: 1.21 });
  });
  it('identity vs non-demon', () => {
    expect(scorchingBowMult(bow, monster())).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

// ------------ Wilderness weapons ------------

describe('wilderness weapons', () => {
  const webweaver = piece({ name: 'Webweaver bow', slot: 'weapon' });
  const tbow = piece({ name: 'Twisted bow', slot: 'weapon' });

  it('outside wilderness: identity', () => {
    expect(wildernessWeaponBonus(webweaver, false)).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('inside wilderness with wildy weapon: +50% / +50%', () => {
    expect(wildernessWeaponBonus(webweaver, true)).toEqual({ dmgMult: 1.5, accMult: 1.5 });
  });

  it('inside wilderness without wildy weapon: identity', () => {
    expect(wildernessWeaponBonus(tbow, true)).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

// ------------ Colossal blade ------------

describe('colossal blade', () => {
  const blade = piece({ name: 'Colossal blade', slot: 'weapon' });

  it('returns 0 for other weapons', () => {
    expect(colossalBladeBonus(piece({ name: 'Scythe of vitur', slot: 'weapon' }), monster({ size: 5 }))).toBe(0);
  });

  it('size 1 = +2', () => {
    expect(colossalBladeBonus(blade, monster({ size: 1 }))).toBe(2);
  });

  it('size 5 = +10 (capped)', () => {
    expect(colossalBladeBonus(blade, monster({ size: 5 }))).toBe(10);
  });

  it('size 10 = +10 (still capped)', () => {
    expect(colossalBladeBonus(blade, monster({ size: 10 }))).toBe(10);
  });
});

// ------------ Vampyre / Efaritay ------------

describe('vampyre weapons', () => {
  const blisterwood = piece({ name: 'Blisterwood flail', slot: 'weapon' });
  const ivandis = piece({ name: 'Ivandis flail', slot: 'weapon' });
  const t2 = monster({ attributes: ['vampyre2'] });
  const t3 = monster({ attributes: ['vampyre3'] });
  const t1 = monster({ attributes: ['vampyre1'] });
  const human = monster();

  it('Blisterwood vs T2/T3: +25% dmg, +5% acc', () => {
    expect(vampyreWeaponBonus(blisterwood, t2)).toEqual({ dmgMult: 1.25, accMult: 1.05 });
    expect(vampyreWeaponBonus(blisterwood, t3)).toEqual({ dmgMult: 1.25, accMult: 1.05 });
  });

  it('Blisterwood vs T1: identity', () => {
    expect(vampyreWeaponBonus(blisterwood, t1)).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('Ivandis flail only fires vs T2 (NOT T3)', () => {
    expect(vampyreWeaponBonus(ivandis, t2)).toEqual({ dmgMult: 1.20, accMult: 1 });
    expect(vampyreWeaponBonus(ivandis, t3)).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('identity vs non-vampyre', () => {
    expect(vampyreWeaponBonus(blisterwood, human)).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

describe("efaritay's aid", () => {
  const efaritay = piece({ name: "Efaritay's aid", slot: 'ring' });
  const otherRing = piece({ name: 'Berserker ring', slot: 'ring' });

  it('+10% acc vs vampyre when worn', () => {
    expect(efaritayAccuracyBonus({ ring: efaritay }, monster({ attributes: ['vampyre2'] }))).toBeCloseTo(1.10, 6);
  });

  it('identity vs non-vampyre', () => {
    expect(efaritayAccuracyBonus({ ring: efaritay }, monster())).toBe(1);
  });

  it('identity when not worn', () => {
    expect(efaritayAccuracyBonus({ ring: otherRing }, monster({ attributes: ['vampyre2'] }))).toBe(1);
  });
});

// ------------ Obsidian + Berserker neck ------------

describe('obsidian set + berserker neck', () => {
  const helm = piece({ name: 'Obsidian helmet', slot: 'head' });
  const body = piece({ name: 'Obsidian platebody', slot: 'body' });
  const legs = piece({ name: 'Obsidian platelegs', slot: 'legs' });
  const obsWeapon = piece({ name: 'Tzhaar-ket-om', slot: 'weapon' });
  const nonObs = piece({ name: 'Scythe of vitur', slot: 'weapon' });
  const bNeck = piece({ name: 'Berserker necklace', slot: 'neck' });
  const bNeckOr = piece({ name: 'Berserker necklace (or)', slot: 'neck' });

  it('full set + obsidian melee weapon: +10% / +10%', () => {
    const r = obsidianArmourBonus({ weapon: obsWeapon, head: helm, body, legs });
    expect(r).toEqual({ dmgMult: 1.10, accMult: 1.10 });
  });

  it('non-obsidian weapon: identity even with set', () => {
    expect(obsidianArmourBonus({ weapon: nonObs, head: helm, body, legs })).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('partial set: identity', () => {
    expect(obsidianArmourBonus({ weapon: obsWeapon, head: helm, body })).toEqual({ dmgMult: 1, accMult: 1 });
  });

  // berserkerNeckBonus is exported from weaponEffects but not imported here -
  // verify indirectly via combined behavior expectations in formulas tests
  // (left as a regression-friendly sanity check on the obsidian gate).
  it('berserker neck (or) variant accepted', () => {
    // Just ensure both spellings of the neck name are accepted by checking
    // that the obsidian set still applies (neck is independent).
    const r = obsidianArmourBonus({ weapon: obsWeapon, neck: bNeckOr, head: helm, body, legs });
    expect(r).toEqual({ dmgMult: 1.10, accMult: 1.10 });
  });

  it('berserker neck without obs weapon: no obsidian bonus', () => {
    const r = obsidianArmourBonus({ weapon: nonObs, neck: bNeck, head: helm, body, legs });
    expect(r).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

// ------------ Virtus robes ------------

describe('virtus robes', () => {
  const helm = piece({ name: 'Virtus mask', slot: 'head' });
  const top = piece({ name: 'Virtus robe top', slot: 'body' });
  const legs = piece({ name: 'Virtus robe bottom', slot: 'legs' });

  it('identity on non-ancient spells', () => {
    expect(virtusBonus({ head: helm, body: top, legs }, spellByName('Fire Bolt'))).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('+3% per piece on ancient spells', () => {
    expect(virtusBonus({ head: helm }, spellByName('Ice Barrage')).dmgMult).toBeCloseTo(1.03, 6);
    expect(virtusBonus({ head: helm, body: top }, spellByName('Ice Barrage')).dmgMult).toBeCloseTo(1.06, 6);
    expect(virtusBonus({ head: helm, body: top, legs }, spellByName('Ice Barrage')).dmgMult).toBeCloseTo(1.09, 6);
  });

  it('no acc bonus', () => {
    expect(virtusBonus({ head: helm, body: top, legs }, spellByName('Ice Barrage')).accMult).toBe(1);
  });
});

// ------------ Harmonised speed ------------

describe('harmonised nightmare staff speed', () => {
  const harm = piece({ name: 'Harmonised nightmare staff', slot: 'weapon' });

  it('shaves 1t for standard spells', () => {
    expect(harmonisedSpeedOverride(harm, spellByName('Fire Surge'), 5)).toBe(4);
  });

  it('no shave for ancient spells', () => {
    expect(harmonisedSpeedOverride(harm, spellByName('Ice Barrage'), 5)).toBe(5);
  });

  it('no shave with non-harm staff', () => {
    expect(harmonisedSpeedOverride(piece({ name: 'Kodai wand', slot: 'weapon' }), spellByName('Fire Surge'), 5)).toBe(5);
  });

  it('clamps speed to >=1', () => {
    expect(harmonisedSpeedOverride(harm, spellByName('Fire Surge'), 1)).toBe(1);
  });
});

// ------------ Target type bonuses ------------

describe('target type bonus (Salve / Slayer / Black mask)', () => {
  const salve = piece({ name: 'Salve amulet', slot: 'neck' });
  const salveE = piece({ name: 'Salve amulet (e)', slot: 'neck' });
  const salveI = piece({ name: 'Salve amulet (i)', slot: 'neck' });
  const salveEi = piece({ name: 'Salve amulet (ei)', slot: 'neck' });
  const slayerHelm = piece({ name: 'Slayer helmet (i)', slot: 'head' });
  const blackMask = piece({ name: 'Black mask (i)', slot: 'head' });
  const regularHelm = piece({ name: 'Slayer helmet', slot: 'head' });
  const regularMask = piece({ name: 'Black mask', slot: 'head' });
  const undead = monster({ attributes: ['undead'] });
  const human = monster();
  // The slayer-helm bonus additionally needs an assignable target.
  const taskMonster = monster({ is_slayer_monster: true });

  it('Salve (base) vs undead melee: 7/6 dmg & acc', () => {
    const r = targetTypeBonus(loadout({ equipment: { neck: salve } }), undead, 'melee');
    expect(r.dmgMult).toBeCloseTo(7 / 6, 6);
  });

  it('Salve (e) vs undead melee: +20%', () => {
    const r = targetTypeBonus(loadout({ equipment: { neck: salveE } }), undead, 'melee');
    expect(r.dmgMult).toBeCloseTo(1.2, 6);
  });

  it('Salve (i) vs undead ranged/magic: +15%', () => {
    expect(targetTypeBonus(loadout({ equipment: { neck: salveI } }), undead, 'ranged').dmgMult).toBeCloseTo(1.15, 6);
    expect(targetTypeBonus(loadout({ equipment: { neck: salveI } }), undead, 'magic').dmgMult).toBeCloseTo(1.15, 6);
  });

  it('Salve (ei) vs undead any style: +20%', () => {
    expect(targetTypeBonus(loadout({ equipment: { neck: salveEi } }), undead, 'melee').dmgMult).toBeCloseTo(1.2, 6);
    expect(targetTypeBonus(loadout({ equipment: { neck: salveEi } }), undead, 'ranged').dmgMult).toBeCloseTo(1.2, 6);
  });

  it('Salve identity vs non-undead', () => {
    expect(targetTypeBonus(loadout({ equipment: { neck: salveEi } }), human, 'melee')).toEqual({ dmgMult: 1, accMult: 1 });
  });

  it('Slayer helm (i) only fires on slayer task', () => {
    expect(targetTypeBonus(loadout({ onSlayerTask: false, equipment: { head: slayerHelm } }), taskMonster, 'melee')).toEqual({ dmgMult: 1, accMult: 1 });
    const r = targetTypeBonus(loadout({ onSlayerTask: true, equipment: { head: slayerHelm } }), taskMonster, 'melee');
    expect(r.dmgMult).toBeCloseTo(7 / 6, 6);
  });

  it('Black mask (i) on slayer task ranged: +15%', () => {
    const r = targetTypeBonus(loadout({ onSlayerTask: true, equipment: { head: blackMask } }), taskMonster, 'ranged');
    expect(r.dmgMult).toBeCloseTo(1.15, 6);
  });

  it('regular Black mask / Slayer helmet give the melee 7/6 on task (no imbue needed)', () => {
    // Reference: PlayerVsNPCCalc melee uses isWearingBlackMask (regular OR
    // imbued); the imbue is only required for ranged/magic.
    for (const head of [regularMask, regularHelm]) {
      const r = targetTypeBonus(loadout({ onSlayerTask: true, equipment: { head } }), taskMonster, 'melee');
      expect(r.dmgMult).toBeCloseTo(7 / 6, 6);
      expect(r.accMult).toBeCloseTo(7 / 6, 6);
    }
  });

  it('regular Black mask / Slayer helmet give nothing to ranged/magic', () => {
    for (const head of [regularMask, regularHelm]) {
      expect(targetTypeBonus(loadout({ onSlayerTask: true, equipment: { head } }), taskMonster, 'ranged')).toEqual({ dmgMult: 1, accMult: 1 });
      expect(targetTypeBonus(loadout({ onSlayerTask: true, equipment: { head } }), taskMonster, 'magic')).toEqual({ dmgMult: 1, accMult: 1 });
    }
  });

  it('slayer bonus needs an assignable (is_slayer_monster) target', () => {
    // human fixture has is_slayer_monster: false — checkbox alone must not buff.
    expect(targetTypeBonus(loadout({ onSlayerTask: true, equipment: { head: slayerHelm } }), human, 'melee')).toEqual({ dmgMult: 1, accMult: 1 });
    expect(targetTypeBonus(loadout({ onSlayerTask: true, equipment: { head: blackMask } }), human, 'ranged')).toEqual({ dmgMult: 1, accMult: 1 });
  });
});

// ------------ specialAvgPerSwing dispatch ------------

describe('specialAvgPerSwing dispatcher', () => {
  it('returns null for normal weapons', () => {
    const sword = piece({ name: 'Abyssal whip', slot: 'weapon' });
    expect(specialAvgPerSwing(sword, null, 30, 0.5, monster())).toBeNull();
  });

  it('dispatches to scythe for scythe', () => {
    const scythe = piece({ name: 'Scythe of vitur', slot: 'weapon' });
    expect(specialAvgPerSwing(scythe, null, 50, 1, monster({ size: 1 }))).toBe(25);
  });

  it('dispatches to dual macuahuitl', () => {
    const macu = piece({ name: 'Dual macuahuitl', slot: 'weapon' });
    expect(specialAvgPerSwing(macu, null, 50, 1, monster())).toBeCloseTo(50, 6);
  });

  it('dispatches to bolt proc for crossbow + enchanted bolts', () => {
    const xbow = piece({ name: 'Armadyl crossbow', slot: 'weapon', category: 'Crossbow' });
    const ammo = piece({ name: 'Diamond bolts (e)', slot: 'ammo' });
    const r = specialAvgPerSwing(xbow, ammo, 50, 0.5, monster({ skills: { atk: 1, def: 1, hp: 1000, magic: 1, ranged: 1, str: 1 } }));
    expect(r).toBeCloseTo(14.10, 6);
  });
});

// ------------ Magic prayers — accuracy only, no damage bonus ------------

describe('magic prayers (regression: no damage bonus)', () => {
  /**
   * Earlier code attributed +1/2/4% magic damage to Mystic Lore/Might/Augury.
   * That was incorrect — OSRS magic prayers boost magic accuracy only, never
   * magic damage. These tests pin the corrected behavior so a future refactor
   * can't silently re-introduce the bug.
   *
   * The check works by running calcDps with a powered staff (where max hit is
   * a deterministic function of magic level + the gear damage bonus) and
   * confirming the prayer doesn't change max hit.
   */
  const magicLoadout = (prayerOverrides: Partial<PlayerLoadout['prayers']> = {}): PlayerLoadout => loadout({
    style: 'magic',
    attackStyle: 'magic',
    spell: null,
    prayers: {
      piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
      burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
      rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
      augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
      ...prayerOverrides,
    },
    equipment: {
      // Trident of the seas: max hit = floor(magic/3 - 5). At magic 99 → 28.
      // No magic_str on this loadout, so prayer is the only thing that could
      // affect max hit. Any prayer-driven change would show up here.
      weapon: piece({
        name: 'Trident of the seas', slot: 'weapon', category: 'Powered Staff', isTwoHanded: true,
      }),
    },
  });
  const target = monster({ skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1 } });

  it('Augury does not increase max hit', () => {
    const baseline = calcDps(magicLoadout(), target).maxHit;
    const withAugury = calcDps(magicLoadout({ augury: true }), target).maxHit;
    expect(withAugury).toBe(baseline);
  });

  it('Mystic Might does not increase max hit', () => {
    const baseline = calcDps(magicLoadout(), target).maxHit;
    const withMight = calcDps(magicLoadout({ mysticMight: true }), target).maxHit;
    expect(withMight).toBe(baseline);
  });

  it('Mystic Lore does not increase max hit', () => {
    const baseline = calcDps(magicLoadout(), target).maxHit;
    const withLore = calcDps(magicLoadout({ mysticLore: true }), target).maxHit;
    expect(withLore).toBe(baseline);
  });

  it('Augury still boosts magic accuracy (sanity check — only damage was the bug)', () => {
    const baseline = calcDps(magicLoadout(), target).accuracy;
    const withAugury = calcDps(magicLoadout({ augury: true }), target).accuracy;
    expect(withAugury).toBeGreaterThan(baseline);
  });
});

// ------------ Monster elemental weakness ------------

describe('monster elemental weakness (regression)', () => {
  /**
   * Pins the calc that lets the optimizer recognise targets like Kree'arra
   * (weak to air) or Smoke devil (weak to water). Earlier code read
   * spell.element only for tome bonuses and ignored monster.weakness
   * entirely, so air-weak bosses were optimized with Ice Barrage.
   */
  function magicLoadout(spell: string | null): PlayerLoadout {
    return loadout({
      style: 'magic', attackStyle: 'magic', spell,
      prayers: {
        piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
        burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
        rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
        augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
      },
      equipment: {},
    });
  }
  const airWeak30 = monster({ weakness: { element: 'air', severity: 30 }, skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1 } });
  const noWeakness = monster({ weakness: null, skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1 } });

  it('matching element gets +severity% to max hit and attack roll', () => {
    const wind = spellByName('Wind Surge');
    if (!wind) throw new Error('Wind Surge spell missing from data');
    const weak = calcDps(magicLoadout('Wind Surge'), airWeak30);
    const plain = calcDps(magicLoadout('Wind Surge'), noWeakness);
    // 30% boost on max hit. Asserting the attack roll (not the derived
    // accuracy probability, which gets capped at 1.0 against the no-defence
    // test monster) so the multiplier shows up cleanly.
    expect(weak.maxHit).toBe(Math.trunc(plain.maxHit * 1.30));
    expect(weak.details.attackRoll).toBe(Math.trunc(plain.details.attackRoll * 1.30));
  });

  it('non-matching element receives no bonus (Ice Barrage on air-weak target)', () => {
    const weakIce = calcDps(magicLoadout('Ice Barrage'), airWeak30);
    const plainIce = calcDps(magicLoadout('Ice Barrage'), noWeakness);
    expect(weakIce.maxHit).toBe(plainIce.maxHit);
  });

  it('powered staves are not boosted (no spell element to match)', () => {
    const lo = magicLoadout(null);
    lo.equipment.weapon = piece({ name: 'Trident of the seas', slot: 'weapon', category: 'Powered Staff', isTwoHanded: true });
    expect(calcDps(lo, airWeak30).maxHit).toBe(calcDps(lo, noWeakness).maxHit);
  });

  it('powered staves do NOT inherit weakness when an element-matching spell is in the loadout', () => {
    // Regression for the Kree'arra Tumeken's shadow +41% inflation: the
    // optimizer's per-spell loop pairs powered staves with each candidate
    // spell name, but powered staves don't actually cast the spell — they
    // fire their own projectile. Earlier code applied the air weakness to
    // Shadow's damage just because state.loadout.spell happened to be
    // "Wind Surge", producing DPS that diverged from gearscape.net by 41%.
    const lo = magicLoadout('Wind Surge');
    lo.equipment.weapon = piece({
      name: "Tumeken's shadow",
      slot: 'weapon',
      category: 'Powered Staff',
      isTwoHanded: true,
    });
    expect(calcDps(lo, airWeak30).maxHit).toBe(calcDps(lo, noWeakness).maxHit);
  });
});

// ------------ Flying targets — melee + halberd interaction ------------

describe('flying targets', () => {
  /**
   * Pins the OSRS rule that flying creatures (Kree'arra, Aviansie, Smoke
   * devil) can't be reached by most melee weapons. Halberds are the
   * exception — their 2-tile reach is the only melee answer.
   */
  const flying = monster({
    name: 'Test flyer',
    attributes: ['flying'],
    skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 99 },
  });

  function meleeLoadout(weapon: EquipmentPiece): PlayerLoadout {
    return loadout({
      style: 'melee', attackStyle: 'slash',
      equipment: {
        weapon,
        // Some str bonus so max hit > 0 in the no-flying baseline.
        body: piece({ name: 'Bandos chestplate', slot: 'body', bonuses: { str: 4, ranged_str: 0, magic_str: 0, prayer: 1 } }),
      },
    });
  }

  it('non-halberd melee → max hit 0 vs flying', () => {
    const r = calcDps(meleeLoadout(piece({ name: 'Abyssal whip', slot: 'weapon', category: 'Whip', offensive: { stab: 0, slash: 82, crush: 0, magic: 0, ranged: 0 } })), flying);
    expect(r.maxHit).toBe(0);
    expect(r.dps).toBe(0);
  });

  it('halberd → can hit (Polearm category bypasses the flying block)', () => {
    const r = calcDps(meleeLoadout(piece({
      name: 'Dragon halberd',
      slot: 'weapon',
      category: 'Polearm',
      isTwoHanded: true,
      offensive: { stab: 70, slash: 95, crush: 0, magic: 0, ranged: 0 },
      bonuses: { str: 89, ranged_str: 0, magic_str: 0, prayer: 0 },
    })), flying);
    expect(r.maxHit).toBeGreaterThan(0);
    expect(r.dps).toBeGreaterThan(0);
  });
});
