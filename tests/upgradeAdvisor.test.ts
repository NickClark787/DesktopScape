import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcDps } from '@engine/formulas';
import { findBestMeleeSetup } from '@engine/bestSetup';
import { findUpgrades } from '@engine/upgradeAdvisor';
import type { EquipmentPiece, Monster, PlayerLoadout, Prayers } from '@shared/types';

const DATA = resolve(process.cwd(), 'resources/data');
const equipment: EquipmentPiece[] = JSON.parse(readFileSync(resolve(DATA, 'equipment.json'), 'utf8'));
const monsters: Monster[] = JSON.parse(readFileSync(resolve(DATA, 'monsters.json'), 'utf8'));
const abyssalDemon = monsters.find((m) => m.id === 415)!;

const NO_PRAYERS: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};

const baseLoadout: PlayerLoadout = {
  style: 'melee', attackStyle: 'slash',
  skills: { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
  prayers: { ...NO_PRAYERS }, potions: { melee: 'none', ranged: 'none', magic: 'none' },
  onSlayerTask: false, inWilderness: false, equipment: {}, spell: null, stance: 'accurate',
};

const best = findBestMeleeSetup(baseLoadout, abyssalDemon, equipment, { shortlistPerSlot: 5 })!;

describe('findUpgrades', () => {
  it('suggests positive single-slot upgrades from an empty loadout, sorted by DPS gain', () => {
    const report = findUpgrades(baseLoadout, abyssalDemon, best);
    expect(report.suggestions.length).toBeGreaterThan(0);
    expect(report.baseline).toBeCloseTo(calcDps(baseLoadout, abyssalDemon).dps, 6);
    for (const s of report.suggestions) expect(s.delta).toBeGreaterThan(0);
    for (let i = 1; i < report.suggestions.length; i++) {
      expect(report.suggestions[i - 1].delta).toBeGreaterThanOrEqual(report.suggestions[i].delta);
    }
  });

  it('reports an accurate delta — applying a suggestion reproduces its DPS', () => {
    const report = findUpgrades(baseLoadout, abyssalDemon, best);
    const top = report.suggestions[0];
    const ld: PlayerLoadout = {
      ...baseLoadout,
      equipment: { ...baseLoadout.equipment, ...top.changes },
      stance: top.stance ?? baseLoadout.stance,
      attackStyle: top.attackStyle ?? baseLoadout.attackStyle,
      spell: top.spell ?? baseLoadout.spell,
    };
    const dps = calcDps(ld, abyssalDemon).dps;
    expect(dps).toBeCloseTo(top.dps, 6);
    expect(top.dps - report.baseline).toBeCloseTo(top.delta, 6);
  });

  it('reports atOptimum with no suggestions when already wearing the best setup', () => {
    const atBest: PlayerLoadout = {
      ...baseLoadout,
      equipment: best.equipment,
      stance: best.stance,
      attackStyle: best.attackStyle,
      spell: best.spell ?? null,
    };
    const report = findUpgrades(atBest, abyssalDemon, best);
    expect(report.atOptimum).toBe(true);
    expect(report.suggestions).toEqual([]);
  });

  it('tags suggestions by ownership', () => {
    const headId = best.equipment.head?.id;
    expect(headId).toBeDefined();
    const owned = new Set<number>([headId!]);
    const report = findUpgrades(baseLoadout, abyssalDemon, best, owned);
    const headSug = report.suggestions.find((s) => s.slot === 'head');
    if (headSug) expect(headSug.owned).toBe(true);
    // Items not in the owned set are tagged not-owned (buy targets).
    expect(report.suggestions.some((s) => !s.owned)).toBe(true);
  });
});
