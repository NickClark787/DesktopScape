/**
 * Style/weapon immunity gates — ported from the wiki calculator's isImmune.
 * These pin the "0 DPS" verdicts that stop the optimizer recommending gear
 * the game would bounce off (Zulrah melee, Tekton ranged, Kurask without a
 * leaf-bladed weapon, …), plus the special-weapon damage bonuses that ride
 * along (rat-bane +10, leaf-bladed battleaxe ×47/40).
 */
import { describe, expect, it } from 'vitest';
import type { EquipmentPiece, Monster, MonsterSkills, PlayerLoadout, StyleStats } from '@shared/types';
import { styleImmunityReason } from '@engine/immunities';
import { calcDps } from '@engine/formulas';
import { spellByName } from '@engine/spells';

const ZERO_STATS: StyleStats = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 };

function piece(overrides: Partial<EquipmentPiece> & Pick<EquipmentPiece, 'name' | 'slot'>): EquipmentPiece {
  return {
    id: 0, version: '', image: '', weight: 0, speed: 4, category: '',
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS }, defensive: { ...ZERO_STATS }, isTwoHanded: false,
    ...overrides,
  };
}

function monster(overrides: Partial<Monster> = {}): Monster {
  const skills: MonsterSkills = { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1, ...(overrides.skills ?? {}) };
  return {
    id: 0, name: 'Test', version: '', image: '', level: 1, speed: 4, style: [], size: 1, max_hit: '0',
    skills,
    offensive: { atk: 0, str: 0, magic: 0, magic_str: 0, ranged: 0, ranged_str: 0 },
    defensive: { flat_armour: 0, stab: 0, slash: 0, crush: 0, magic: 0, heavy: 0, standard: 0, light: 0 },
    attributes: [], immunities: null, is_slayer_monster: false, weakness: null,
    ...overrides,
  };
}

function loadout(overrides: Partial<PlayerLoadout> = {}): PlayerLoadout {
  return {
    style: 'melee', attackStyle: 'slash',
    skills: { atk: 99, def: 99, str: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
    prayers: {
      piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
      burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
      rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
      augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
    },
    potions: { melee: 'none', ranged: 'none', magic: 'none' },
    onSlayerTask: false, inWilderness: false, equipment: {}, spell: null,
    ...overrides,
  };
}

const whip = piece({ name: 'Abyssal whip', slot: 'weapon', category: 'Whip', offensive: { ...ZERO_STATS, slash: 82 } });
const halberd = piece({ name: 'Dragon halberd', slot: 'weapon', category: 'Polearm', isTwoHanded: true, offensive: { ...ZERO_STATS, slash: 95 }, bonuses: { str: 89, ranged_str: 0, magic_str: 0, prayer: 0 } });
const bow = piece({ name: 'Magic shortbow', slot: 'weapon', category: 'Bow', isTwoHanded: true, offensive: { ...ZERO_STATS, ranged: 69 } });
const arrows = piece({ name: 'Rune arrow', slot: 'ammo', bonuses: { str: 0, ranged_str: 49, magic_str: 0, prayer: 0 } });

const zulrah = monster({ id: 2042, name: 'Zulrah' });
const tekton = monster({ id: 7540, name: 'Tekton', attributes: ['xerician'] });
const dusk = monster({ id: 7888, name: 'Dusk' });
const kurask = monster({ id: 410, name: 'Kurask', attributes: ['leafy'] });
const aviansie = monster({ id: 3170, name: 'Aviansie', attributes: ['flying'] });
const vespula = monster({ id: 7530, name: 'Vespula', attributes: ['xerician', 'flying'] });
const guardian = monster({ id: 7569, name: 'Guardian' });
const rat = monster({ id: 1680, name: 'Giant crypt rat', attributes: ['rat'] });

describe('styleImmunityReason — ID-based style immunities', () => {
  it('Zulrah is immune to melee, except polearms', () => {
    expect(styleImmunityReason(zulrah, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeTruthy();
    expect(styleImmunityReason(zulrah, { style: 'melee', weapon: halberd, ammo: null, spell: null })).toBeNull();
    expect(styleImmunityReason(zulrah, { style: 'ranged', weapon: bow, ammo: arrows, spell: null })).toBeNull();
  });

  it('Kraken / Zuk / Leviathan are melee-immune with no polearm exception', () => {
    for (const id of [494, 7706, 12214]) {
      const m = monster({ id, name: 'MeleeImmune' });
      expect(styleImmunityReason(m, { style: 'melee', weapon: halberd, ammo: null, spell: null })).toBeTruthy();
    }
  });

  it('Tekton / Dusk / Glowing crystal / WG cyclopes are ranged-immune', () => {
    for (const m of [tekton, dusk, monster({ id: 7568 }), monster({ id: 2463 })]) {
      expect(styleImmunityReason(m, { style: 'ranged', weapon: bow, ammo: arrows, spell: null })).toBeTruthy();
    }
    expect(styleImmunityReason(tekton, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeNull();
  });

  it('Dusk / WG cyclopes are magic-immune', () => {
    expect(styleImmunityReason(dusk, { style: 'magic', weapon: null, ammo: null, spell: spellByName('Fire Surge') })).toBeTruthy();
    expect(styleImmunityReason(monster({ id: 2137 }), { style: 'magic', weapon: null, ammo: null, spell: null })).toBeTruthy();
  });
});

describe('styleImmunityReason — attribute/weapon-class gates', () => {
  it('flying targets need a polearm or salamander in melee', () => {
    const flyer = monster({ name: 'Kree', attributes: ['flying'] });
    expect(styleImmunityReason(flyer, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeTruthy();
    expect(styleImmunityReason(flyer, { style: 'melee', weapon: halberd, ammo: null, spell: null })).toBeNull();
    const salamander = piece({ name: 'Black salamander', slot: 'weapon', category: 'Salamander' });
    expect(styleImmunityReason(flyer, { style: 'melee', weapon: salamander, ammo: null, spell: null })).toBeNull();
  });

  it('Vespula is melee-immune even with a polearm', () => {
    expect(styleImmunityReason(vespula, { style: 'melee', weapon: halberd, ammo: null, spell: null })).toBeTruthy();
  });

  it('aviansies can only be meleed with a salamander (halberds do not work)', () => {
    expect(styleImmunityReason(aviansie, { style: 'melee', weapon: halberd, ammo: null, spell: null })).toBeTruthy();
    const salamander = piece({ name: 'Black salamander', slot: 'weapon', category: 'Salamander' });
    expect(styleImmunityReason(aviansie, { style: 'melee', weapon: salamander, ammo: null, spell: null })).toBeNull();
  });

  it('CoX Guardians require a melee pickaxe', () => {
    const pick = piece({ name: 'Dragon pickaxe', slot: 'weapon', category: 'Pickaxe' });
    expect(styleImmunityReason(guardian, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeTruthy();
    expect(styleImmunityReason(guardian, { style: 'ranged', weapon: bow, ammo: arrows, spell: null })).toBeTruthy();
    expect(styleImmunityReason(guardian, { style: 'melee', weapon: pick, ammo: null, spell: null })).toBeNull();
  });

  it('leafy needs leaf-bladed melee, broad ammo, or Magic Dart', () => {
    expect(styleImmunityReason(kurask, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeTruthy();
    const lbb = piece({ name: 'Leaf-bladed battleaxe', slot: 'weapon', category: 'Axe' });
    expect(styleImmunityReason(kurask, { style: 'melee', weapon: lbb, ammo: null, spell: null })).toBeNull();
    const broad = piece({ name: 'Broad bolts', slot: 'ammo' });
    const xbow = piece({ name: 'Rune crossbow', slot: 'weapon', category: 'Crossbow' });
    expect(styleImmunityReason(kurask, { style: 'ranged', weapon: xbow, ammo: broad, spell: null })).toBeNull();
    expect(styleImmunityReason(kurask, { style: 'ranged', weapon: xbow, ammo: arrows, spell: null })).toBeTruthy();
    const staff = piece({ name: "Slayer's staff", slot: 'weapon', category: 'Staff' });
    expect(styleImmunityReason(kurask, { style: 'magic', weapon: staff, ammo: null, spell: spellByName('Magic Dart') })).toBeNull();
    expect(styleImmunityReason(kurask, { style: 'magic', weapon: staff, ammo: null, spell: spellByName('Fire Surge') })).toBeTruthy();
  });

  it('rat-bone weapons only damage rats', () => {
    const mace = piece({ name: 'Bone mace', slot: 'weapon', category: 'Blunt' });
    expect(styleImmunityReason(monster(), { style: 'melee', weapon: mace, ammo: null, spell: null })).toBeTruthy();
    expect(styleImmunityReason(rat, { style: 'melee', weapon: mace, ammo: null, spell: null })).toBeNull();
  });
});

describe('styleImmunityReason — vampyres', () => {
  const t1 = monster({ name: 'Juvinate', attributes: ['vampyre1'] });
  const t2 = monster({ name: 'Vyrewatch', attributes: ['vampyre2'] });
  const t3 = monster({ name: 'Vanstrom', attributes: ['vampyre3'] });
  const flail = piece({ name: 'Blisterwood flail', slot: 'weapon' });
  const silverlight = piece({ name: 'Silverlight', slot: 'weapon' });
  const efaritay = piece({ name: "Efaritay's aid", slot: 'ring' });

  it('T3 requires a blisterwood weapon', () => {
    expect(styleImmunityReason(t3, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeTruthy();
    expect(styleImmunityReason(t3, { style: 'melee', weapon: silverlight, ammo: null, spell: null })).toBeTruthy();
    expect(styleImmunityReason(t3, { style: 'melee', weapon: flail, ammo: null, spell: null })).toBeNull();
  });

  it('Blisterwood staff bypasses T2/T3 immunity for magic (wiki extension)', () => {
    const staff = piece({ name: 'Blisterwood staff', slot: 'weapon', category: 'Staff' });
    expect(styleImmunityReason(t3, { style: 'magic', weapon: staff, ammo: null, spell: spellByName('Fire Surge') })).toBeNull();
  });

  it('T2 needs vampyrebane, silver, or Efaritay', () => {
    expect(styleImmunityReason(t2, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeTruthy();
    expect(styleImmunityReason(t2, { style: 'melee', weapon: silverlight, ammo: null, spell: null })).toBeNull();
    expect(styleImmunityReason(t2, {
      style: 'melee', weapon: whip, ammo: null, spell: null,
      equipment: { weapon: whip, ring: efaritay },
    })).toBeNull();
  });

  it('T1 takes damage from anything', () => {
    expect(styleImmunityReason(t1, { style: 'melee', weapon: whip, ammo: null, spell: null })).toBeNull();
  });
});

describe('calcDps integration — vampyres', () => {
  const t2 = monster({ name: 'Vyrewatch', attributes: ['vampyre2'], skills: { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1 } });
  const efaritay = piece({ name: "Efaritay's aid", slot: 'ring' });
  const whipish = piece({ name: 'Abyssal whip', slot: 'weapon', category: 'Whip', offensive: { ...ZERO_STATS, slash: 82 }, bonuses: { str: 82, ranged_str: 0, magic_str: 0, prayer: 0 } });

  it('non-silver weapon vs T2: zero without Efaritay, half damage with it', () => {
    expect(calcDps(loadout({ equipment: { weapon: whipish } }), t2).dps).toBe(0);
    const withAid = calcDps(loadout({ equipment: { weapon: whipish, ring: efaritay } }), t2);
    // effStr 107, str bonus 82: base = floor(0.5 + 107*146/640) = 24 → halved = 12.
    expect(withAid.maxHit).toBe(12);
    expect(withAid.dps).toBeGreaterThan(0);
  });

  it('bare silver weapon vs T2: hits capped at 10 with capped expectation', () => {
    const silverlight = piece({
      name: 'Silverlight', slot: 'weapon', category: 'Slash Sword',
      offensive: { ...ZERO_STATS, slash: 13 }, bonuses: { str: 12, ranged_str: 0, magic_str: 0, prayer: 0 },
    });
    const r = calcDps(loadout({ equipment: { weapon: silverlight } }), t2);
    expect(r.maxHit).toBe(10);
    // base max = floor(0.5 + 107*(12+64)/640) = floor(13.2) = 13, capped at 10.
    // E[min(U(0..13),10)] = (55 + 3*10)/14 = 85/14; avg = acc × 6.0714…
    const expectedAvg = r.accuracy * (85 / 14);
    expect(r.avgHit).toBeCloseTo(expectedAvg, 6);
  });

  it('blisterwood flail + Efaritay stacks ×11/10 then ×5/4', () => {
    const flail = piece({
      name: 'Blisterwood flail', slot: 'weapon', category: 'Blunt',
      offensive: { ...ZERO_STATS, crush: 60 }, bonuses: { str: 50, ranged_str: 0, magic_str: 0, prayer: 0 },
    });
    const r = calcDps(loadout({ attackStyle: 'crush', equipment: { weapon: flail, ring: efaritay } }), t2);
    // base = floor(0.5 + 107*114/640) = floor(19.55) = 19 → ×11/10 = 20 → ×5/4 = 25.
    expect(r.maxHit).toBe(25);
  });
});

describe('calcDps integration', () => {
  it('Zulrah melee with a whip → 0 DPS; halberd hits', () => {
    const base = loadout({ equipment: { weapon: whip } });
    expect(calcDps(base, zulrah).dps).toBe(0);
    const withHalberd = loadout({ equipment: { weapon: halberd } });
    expect(calcDps(withHalberd, zulrah).dps).toBeGreaterThan(0);
  });

  it('Tekton ranged → 0 DPS, melee unaffected', () => {
    const ranged = loadout({ style: 'ranged', attackStyle: 'ranged', equipment: { weapon: bow, ammo: arrows } });
    expect(calcDps(ranged, tekton).dps).toBe(0);
    const melee = loadout({ equipment: { weapon: whip } });
    expect(calcDps(melee, tekton).dps).toBeGreaterThan(0);
  });

  it('Kurask: whip → 0, leaf-bladed battleaxe hits with ×47/40', () => {
    expect(calcDps(loadout({ equipment: { weapon: whip } }), kurask).dps).toBe(0);
    const lbb = piece({
      name: 'Leaf-bladed battleaxe', slot: 'weapon', category: 'Axe',
      offensive: { ...ZERO_STATS, slash: 72 }, bonuses: { str: 92, ranged_str: 0, magic_str: 0, prayer: 0 },
    });
    const r = calcDps(loadout({ equipment: { weapon: lbb } }), kurask);
    expect(r.dps).toBeGreaterThan(0);
    // Base max: floor(0.5 + eff*(92+64)/640) with eff = 99+8+3(acc stance) = 110... stance
    // defaults to accurate → effStr = 99 + 0 + 8 = 107 (accurate adds atk not str).
    // base = floor(0.5 + 107*156/640) = floor(26.58) = 26 → ×47/40 = trunc(30.55) = 30.
    expect(r.maxHit).toBe(30);
  });

  it('Bone mace gets +10 max hit vs rats and zero elsewhere', () => {
    const mace = piece({
      name: 'Bone mace', slot: 'weapon', category: 'Blunt',
      offensive: { ...ZERO_STATS, crush: 20 }, bonuses: { str: 15, ranged_str: 0, magic_str: 0, prayer: 0 },
    });
    const vsRat = calcDps(loadout({ attackStyle: 'crush', equipment: { weapon: mace } }), rat);
    // base = floor(0.5 + 107*(15+64)/640) = floor(13.7) = 13 → +10 = 23
    expect(vsRat.maxHit).toBe(23);
    const vsOther = calcDps(loadout({ attackStyle: 'crush', equipment: { weapon: mace } }), monster());
    expect(vsOther.dps).toBe(0);
  });

  it('immunity verdict surfaces in the effects panel', () => {
    const r = calcDps(loadout({ equipment: { weapon: whip } }), zulrah);
    expect(r.effects.some((e) => e.name === 'Immune target')).toBe(true);
  });
});
