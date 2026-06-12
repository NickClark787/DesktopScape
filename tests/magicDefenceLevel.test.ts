import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcDps } from '@engine/formulas';
import type { EquipmentPiece, Monster, PlayerLoadout, Prayers } from '@shared/types';

const DATA = resolve(process.cwd(), 'resources/data');
const equipment: EquipmentPiece[] = JSON.parse(readFileSync(resolve(DATA, 'equipment.json'), 'utf8'));
const monsters: Monster[] = JSON.parse(readFileSync(resolve(DATA, 'monsters.json'), 'utf8'));
const trident = equipment.find((p) => p.id === 11905)!; // Trident of the seas

const NO_PRAYERS: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};

const mageLoadout: PlayerLoadout = {
  style: 'magic', attackStyle: 'magic',
  skills: { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
  prayers: { ...NO_PRAYERS }, potions: { melee: 'none', ranged: 'none', magic: 'none' },
  onSlayerTask: false, inWilderness: false, equipment: { weapon: trident }, spell: null, stance: 'accurate',
};

describe('per-NPC magic defence level (USES_DEFENCE_LEVEL_FOR_MAGIC_DEFENCE)', () => {
  it('Ice demon rolls magic defence off its Defence level, not Magic', () => {
    const ice = monsters.find((m) => m.id === 7584)!; // def 160, magic 390
    const r = calcDps(mageLoadout, ice);
    expect(r.details.defenceRoll).toBe((ice.skills.def + 9) * (ice.defensive.magic + 64));
    // Sanity: that is very different from the magic-level roll.
    expect(r.details.defenceRoll).not.toBe((ice.skills.magic + 9) * (ice.defensive.magic + 64));
  });

  it('Verzik P1 rolls magic defence off Defence too', () => {
    const verzik = monsters.find((m) => m.id === 8369)!;
    const r = calcDps(mageLoadout, verzik);
    expect(r.details.defenceRoll).toBe((verzik.skills.def + 9) * (verzik.defensive.magic + 64));
  });

  it('normal monsters still roll off the Magic level', () => {
    const abyssal = monsters.find((m) => m.id === 415)!; // magic 1
    const r = calcDps(mageLoadout, abyssal);
    expect(r.details.defenceRoll).toBe((abyssal.skills.magic + 9) * (abyssal.defensive.magic + 64));
  });

  it('defence drain now improves magic accuracy on these NPCs (DWH-the-Ice-demon strat)', () => {
    const ice = monsters.find((m) => m.id === 7584)!;
    const base = calcDps(mageLoadout, ice);
    const drained = calcDps({
      ...mageLoadout,
      defenceReduction: { dwh: 3, elderMaul: 0, arclight: 0, emberlight: 0, bgs: 0, accursed: false, vulnerability: false },
    }, ice);
    expect(drained.accuracy).toBeGreaterThan(base.accuracy);
  });
});
