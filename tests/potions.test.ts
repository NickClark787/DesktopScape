import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcDps } from '@engine/formulas';
import type { EquipmentPiece, Monster, PlayerLoadout, Potions, Prayers } from '@shared/types';

const DATA = resolve(process.cwd(), 'resources/data');
const equipment: EquipmentPiece[] = JSON.parse(readFileSync(resolve(DATA, 'equipment.json'), 'utf8'));
const monsters: Monster[] = JSON.parse(readFileSync(resolve(DATA, 'monsters.json'), 'utf8'));
const abyssal = monsters.find((m) => m.id === 415)!;
const bof = equipment.find((p) => p.id === 25865)!; // Bow of faerdhinen (charged)

const NO_PRAYERS: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};

function rangedLoadout(potion: Potions['ranged']): PlayerLoadout {
  return {
    style: 'ranged', attackStyle: 'ranged',
    skills: { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
    prayers: { ...NO_PRAYERS }, potions: { melee: 'none', ranged: potion, magic: 'none' },
    onSlayerTask: false, inWilderness: false, equipment: { weapon: bof }, spell: null, stance: 'accurate',
  };
}

describe('ranged potion boosts', () => {
  it('Divine ranging gives the Ranging-potion boost (4 + 10%), not the NMZ super tier', () => {
    const divine = calcDps(rangedLoadout('divine_ranging'), abyssal);
    const ranging = calcDps(rangedLoadout('ranging'), abyssal);
    expect(divine.maxHit).toBe(ranging.maxHit);
    expect(divine.details.attackRoll).toBe(ranging.details.attackRoll);
    // At 99 Ranged + accurate: eff str = 99 + (4 + floor(99*0.10)) + 3 + 8 = 123.
    expect(divine.details.effectiveStrength).toBe(123);
  });

  it('NMZ Super ranging keeps the 5 + 15% tier and out-boosts Ranging', () => {
    const sup = calcDps(rangedLoadout('super_ranging'), abyssal);
    // eff str = 99 + (5 + floor(99*0.15)) + 3 + 8 = 129.
    expect(sup.details.effectiveStrength).toBe(129);
    expect(sup.maxHit).toBeGreaterThan(calcDps(rangedLoadout('ranging'), abyssal).maxHit);
  });
});
