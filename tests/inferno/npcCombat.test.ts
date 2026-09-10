/**
 * Monster → player rolls, checked against the formulas in the bundled OSRS
 * wiki calculator (`NPCVsPlayerCalc.getNPCMaxAttackRoll` /
 * `.getPlayerDefenceRoll`, `BaseCalc.getNormalAccuracyRoll`). Values here
 * are recomputed by hand from those formulas, not copied from the engine.
 */
import { describe, expect, it } from 'vitest';
import {
  normalAccuracy, npcAttackRoll, playerDefenceRoll, zukHitChance,
} from '@sim/tzkalZuk/npcCombat';
import { addMonsters, piece, zukMonster } from './fixtures';

const SKILLS = { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 };
const NO_BOOSTS = { def: 0, magic: 0 };

function armour(defBonus: number) {
  return {
    body: piece({
      name: 'Test body', slot: 'body',
      defensive: { stab: defBonus, slash: defBonus, crush: defBonus, magic: defBonus, ranged: defBonus },
    }),
  };
}

describe('NPC attack rolls', () => {
  it('Jal-Xil: (9 + ranged) × (ranged bonus + 64)', () => {
    const xil = addMonsters().ranger!;
    // (9 + 250) × (40 + 64) = 259 × 104
    expect(npcAttackRoll(xil, 'ranged')).toBe(259 * 104);
  });

  it('Jal-Zek: (9 + magic) × (magic bonus + 64)', () => {
    const zek = addMonsters().mager!;
    // (9 + 300) × (80 + 64) = 309 × 144
    expect(npcAttackRoll(zek, 'magic')).toBe(309 * 144);
  });

  it('JalTok-Jad rolls its two ranged/magic styles separately', () => {
    const jad = addMonsters().jad!;
    expect(npcAttackRoll(jad, 'ranged')).toBe((9 + 1020) * (80 + 64));
    expect(npcAttackRoll(jad, 'magic')).toBe((9 + 510) * (100 + 64));
  });
});

describe('player defence roll', () => {
  it('bare level 99: (8 + 99) × 64 against a ranged attack', () => {
    const roll = playerDefenceRoll(
      { skills: SKILLS, boosts: NO_BOOSTS, equipment: {}, stance: 'rapid', rigour: false },
      'ranged',
    );
    expect(roll).toBe((8 + 99) * 64);
  });

  it('magic defence blends 70% magic level with 30% defence level', () => {
    const roll = playerDefenceRoll(
      { skills: SKILLS, boosts: NO_BOOSTS, equipment: {}, stance: 'rapid', rigour: false },
      'magic',
    );
    // trunc(99×7/10) + trunc(99×3/10) = 69 + 29 = 98
    expect(roll).toBe((8 + 98) * 64);
  });

  it('Rigour multiplies the defence level by 125/100', () => {
    const roll = playerDefenceRoll(
      { skills: SKILLS, boosts: NO_BOOSTS, equipment: {}, stance: 'rapid', rigour: true },
      'ranged',
    );
    expect(roll).toBe((8 + Math.trunc((99 * 125) / 100)) * 64);
  });

  it('longrange adds the hidden +3 defence stance bonus', () => {
    const base = { skills: SKILLS, boosts: NO_BOOSTS, equipment: {}, rigour: false };
    const rapid = playerDefenceRoll({ ...base, stance: 'rapid' }, 'ranged');
    const longrange = playerDefenceRoll({ ...base, stance: 'longrange' }, 'ranged');
    expect(longrange - rapid).toBe(3 * 64);
  });

  it('equipment defence bonuses feed the gear term', () => {
    const roll = playerDefenceRoll(
      { skills: SKILLS, boosts: NO_BOOSTS, equipment: armour(120), stance: 'rapid', rigour: false },
      'ranged',
    );
    expect(roll).toBe((8 + 99) * (120 + 64));
  });
});

describe('accuracy roll', () => {
  it('matches the standard OSRS formula in both branches', () => {
    expect(normalAccuracy(1000, 500)).toBeCloseTo(1 - 502 / (2 * 1001), 12);
    expect(normalAccuracy(500, 1000)).toBeCloseTo(500 / (2 * 1001), 12);
  });

  it('better armour lowers the chance a Jal-Xil hits you', () => {
    const xil = addMonsters().ranger!;
    const atk = npcAttackRoll(xil, 'ranged');
    const bare = normalAccuracy(atk, playerDefenceRoll(
      { skills: SKILLS, boosts: NO_BOOSTS, equipment: {}, stance: 'rapid', rigour: false }, 'ranged',
    ));
    const geared = normalAccuracy(atk, playerDefenceRoll(
      { skills: SKILLS, boosts: NO_BOOSTS, equipment: armour(200), stance: 'longrange', rigour: true }, 'ranged',
    ));
    expect(geared).toBeLessThan(bare);
    expect(bare).toBeGreaterThan(0);
    expect(geared).toBeGreaterThan(0);
  });
});

describe('TzKal-Zuk hybrid roll', () => {
  it('averages the ranged and magic rolls on both sides (Mod Ash)', () => {
    const zuk = zukMonster();
    const p = { skills: SKILLS, boosts: NO_BOOSTS, equipment: armour(80), stance: 'rapid' as const, rigour: true };
    const expected = normalAccuracy(
      (npcAttackRoll(zuk, 'ranged') + npcAttackRoll(zuk, 'magic')) / 2,
      (playerDefenceRoll(p, 'ranged') + playerDefenceRoll(p, 'magic')) / 2,
    );
    expect(zukHitChance(zuk, p)).toBeCloseTo(expected, 12);
  });

  it('is very high against a realistically geared player — Zuk is not survivable in the open', () => {
    const zuk = zukMonster();
    const p = { skills: SKILLS, boosts: NO_BOOSTS, equipment: armour(150), stance: 'rapid' as const, rigour: true };
    expect(zukHitChance(zuk, p)).toBeGreaterThan(0.9);
  });
});
