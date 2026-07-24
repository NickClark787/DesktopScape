/**
 * Pure renderer utilities: gp parsing/formatting, item-stat display strings
 * (incl. the magic-damage tenths-of-a-percent conversion), and the shared
 * 2h⇆shield slot-edit helper.
 */
import { describe, expect, it } from 'vitest';
import type { EquipmentPiece, StyleStats } from '@shared/types';
import { parseGp, formatGp } from '@/utils/gp';
import { magicStrPct, pieceStatLines, summarizeStats } from '@/utils/itemStats';
import { applySlotChange } from '@/utils/equipment';

const ZERO_STATS: StyleStats = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 };

function piece(overrides: Partial<EquipmentPiece> & Pick<EquipmentPiece, 'name' | 'slot'>): EquipmentPiece {
  return {
    id: 0, version: '', image: '', weight: 0, speed: 4, category: '',
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS }, defensive: { ...ZERO_STATS }, isTwoHanded: false,
    ...overrides,
  };
}

describe('parseGp', () => {
  it('parses k/m/b suffixes', () => {
    expect(parseGp('100m')).toBe(100_000_000);
    expect(parseGp('1.5b')).toBe(1_500_000_000);
    expect(parseGp('250k')).toBe(250_000);
  });

  it('parses plain digits with commas/spaces', () => {
    expect(parseGp('1,000,000')).toBe(1_000_000);
    expect(parseGp('12 345')).toBe(12_345);
  });

  it('rejects garbage, empty, zero, and negatives', () => {
    expect(parseGp('abc')).toBeNull();
    expect(parseGp('')).toBeNull();
    expect(parseGp('0')).toBeNull();
    expect(parseGp('-5m')).toBeNull();
    expect(parseGp('1.2.3m')).toBeNull();
  });
});

describe('formatGp', () => {
  it('compacts to b/m/k tiers', () => {
    expect(formatGp(1_234_000_000)).toBe('1.23b');
    expect(formatGp(45_200_000)).toBe('45.20m');
    expect(formatGp(250_000)).toBe('250k');
    expect(formatGp(999)).toBe('999');
  });
});

describe('magic damage display (tenths of a percent)', () => {
  it('converts data units to real percent', () => {
    // Occult necklace stores magic_str = 50 → the item is +5%, not +50%.
    expect(magicStrPct(50)).toBe('+5%');
    expect(magicStrPct(25)).toBe('+2.5%');
    expect(magicStrPct(-10)).toBe('-1%');
  });

  it('pieceStatLines uses the converted percent', () => {
    const occult = piece({
      name: 'Occult necklace', slot: 'neck',
      bonuses: { str: 0, ranged_str: 0, magic_str: 50, prayer: 0 },
      offensive: { ...ZERO_STATS, magic: 12 },
    });
    const lines = pieceStatLines(occult);
    expect(lines).toContain('Bonus: magic dmg +5%');
    expect(lines.join('\n')).not.toContain('+50%');
  });

  it('summarizeStats uses the converted percent', () => {
    const occult = piece({
      name: 'Occult necklace', slot: 'neck',
      bonuses: { str: 0, ranged_str: 0, magic_str: 50, prayer: 0 },
      offensive: { ...ZERO_STATS, magic: 12 },
    });
    expect(summarizeStats(occult)).toBe('magic +12 · mag dmg +5%');
  });
});

describe('applySlotChange (2h⇆shield mutex)', () => {
  const twoHander = piece({ name: 'Twisted bow', slot: 'weapon', isTwoHanded: true });
  const oneHander = piece({ name: 'Abyssal whip', slot: 'weapon' });
  const shield = piece({ name: 'Dragon defender', slot: 'shield' });

  it('equipping a 2h weapon clears the shield', () => {
    const next = applySlotChange({ weapon: oneHander, shield }, 'weapon', twoHander);
    expect(next.weapon).toBe(twoHander);
    expect(next.shield).toBeNull();
  });

  it('equipping a shield over a 2h weapon clears the weapon', () => {
    const next = applySlotChange({ weapon: twoHander }, 'shield', shield);
    expect(next.shield).toBe(shield);
    expect(next.weapon).toBeNull();
  });

  it('1h weapon + shield coexist', () => {
    const next = applySlotChange({ weapon: oneHander }, 'shield', shield);
    expect(next.weapon).toBe(oneHander);
    expect(next.shield).toBe(shield);
  });

  it('null unequips without side effects', () => {
    const next = applySlotChange({ weapon: twoHander }, 'weapon', null);
    expect(next.weapon).toBeNull();
  });

  it('does not mutate the input', () => {
    const eq = { weapon: oneHander, shield };
    applySlotChange(eq, 'weapon', twoHander);
    expect(eq.shield).toBe(shield);
  });
});
