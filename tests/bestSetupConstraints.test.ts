import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBestSetup } from '@engine/bestSetup';
import type { EquipmentPiece, Monster, PlayerLoadout, Prayers } from '@shared/types';

const DATA = resolve(process.cwd(), 'resources/data');
const equipment: EquipmentPiece[] = JSON.parse(readFileSync(resolve(DATA, 'equipment.json'), 'utf8'));
const monsters: Monster[] = JSON.parse(readFileSync(resolve(DATA, 'monsters.json'), 'utf8'));
const abyssal = monsters.find((m) => m.id === 415)!;

const NO_PRAYERS: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};

const base: PlayerLoadout = {
  style: 'ranged', attackStyle: 'ranged',
  skills: { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
  prayers: { ...NO_PRAYERS }, potions: { melee: 'none', ranged: 'none', magic: 'none' },
  onSlayerTask: false, inWilderness: false, equipment: {}, spell: null, stance: 'rapid',
};

const OPTS = { style: 'ranged' as const, attackStyle: 'ranged' as const, shortlistPerSlot: 5 };

// Synthetic flat pricing: every item costs exactly 1m, so budget N×1m means
// "at most N unowned pieces" — easy to assert against.
const M = 1_000_000;
const flatPrices = new Map<number, number>(equipment.map((p) => [p.id, M]));

const unconstrained = findBestSetup(base, abyssal, equipment, OPTS)!;
const piecesOf = (eq: PlayerLoadout['equipment']) => Object.values(eq).filter(Boolean) as EquipmentPiece[];

describe('budget-constrained best setup', () => {
  it('keeps total cost within budget and reports it', () => {
    const c = findBestSetup(base, abyssal, equipment, {
      ...OPTS, budget: 3 * M, prices: flatPrices, ownedFree: null,
    })!;
    expect(c.totalCost).toBeDefined();
    expect(c.totalCost!).toBeLessThanOrEqual(3 * M);
    // Flat pricing: cost is exactly 1m per equipped piece.
    expect(c.totalCost).toBe(piecesOf(c.equipment).length * M);
    expect(piecesOf(c.equipment).length).toBeLessThanOrEqual(3);
    expect(c.result.dps).toBeGreaterThan(0);
  });

  it('never beats the unconstrained search, and more budget never hurts', () => {
    const at2 = findBestSetup(base, abyssal, equipment, { ...OPTS, budget: 2 * M, prices: flatPrices })!;
    const at6 = findBestSetup(base, abyssal, equipment, { ...OPTS, budget: 6 * M, prices: flatPrices })!;
    expect(at2.result.dps).toBeLessThanOrEqual(at6.result.dps + 1e-9);
    expect(at6.result.dps).toBeLessThanOrEqual(unconstrained.result.dps + 1e-9);
  });

  it('owned items are free: owning the BiS pieces restores full DPS at any budget', () => {
    const ownedFree = new Set(piecesOf(unconstrained.equipment).map((p) => p.id));
    const c = findBestSetup(base, abyssal, equipment, {
      ...OPTS, budget: 0, prices: flatPrices, ownedFree,
    })!;
    expect(c.result.dps).toBeCloseTo(unconstrained.result.dps, 6);
    expect(c.totalCost).toBe(0);
  });

  it('treats unpriced, unowned items as unbuyable', () => {
    const bisWeapon = unconstrained.equipment.weapon!;
    const noWeaponPrice = new Map(flatPrices);
    noWeaponPrice.delete(bisWeapon.id);
    const c = findBestSetup(base, abyssal, equipment, {
      ...OPTS, budget: 100 * M, prices: noWeaponPrice,
    })!;
    expect(c.equipment.weapon?.id).not.toBe(bisWeapon.id);
  });
});

describe('avoid-list (excludeIds)', () => {
  it('never suggests an excluded item', () => {
    const bisWeapon = unconstrained.equipment.weapon!;
    const c = findBestSetup(base, abyssal, equipment, {
      ...OPTS, excludeIds: new Set([bisWeapon.id]),
    })!;
    expect(c.equipment.weapon?.id).not.toBe(bisWeapon.id);
    expect(c.result.dps).toBeLessThanOrEqual(unconstrained.result.dps + 1e-9);
  });
});
