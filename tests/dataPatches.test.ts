import { describe, expect, it } from 'vitest';
import type { EquipmentPiece, StyleStats } from '@shared/types';
import { patchEquipmentData } from '@shared/dataPatches';

const ZERO_STATS: StyleStats = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 };

function piece(name: string, rangedStr: number, rangedOff: number): EquipmentPiece {
  return {
    id: 0,
    name,
    version: '',
    image: '',
    weight: 0,
    speed: 4,
    category: '',
    bonuses: { str: 0, ranged_str: rangedStr, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS, ranged: rangedOff },
    defensive: { ...ZERO_STATS },
    isTwoHanded: false,
    slot: 'ammo',
  };
}

describe('patchEquipmentData', () => {
  it('zeroes the four training arrows that ship with inflated +125 ranged_str', () => {
    // Upstream OSRS Wiki data assigns +125 ranged_str to these training
    // arrow variants — they're practice/event items in-game and have no
    // combat use. Without the patch, the optimizer picks "Barbed arrow"
    // as BiS ammo over Dragon arrow (+60).
    const eq = [
      piece('Barbed arrow', 125, 46),
      piece('Blunt arrow', 125, 46),
      piece('Bullet arrow', 125, 46),
      piece('Field arrow', 125, 46),
      piece('Dragon arrow', 60, 0), // control: should be untouched
    ];
    patchEquipmentData(eq);
    expect(eq[0].bonuses.ranged_str).toBe(0);
    expect(eq[1].bonuses.ranged_str).toBe(0);
    expect(eq[2].bonuses.ranged_str).toBe(0);
    expect(eq[3].bonuses.ranged_str).toBe(0);
    // Also zero the offensive ranged stat for completeness.
    expect(eq[0].offensive.ranged).toBe(0);
    // Dragon arrow (control) untouched.
    expect(eq[4].bonuses.ranged_str).toBe(60);
  });

  it('zeroes the Castle Wars supply ammo (minigame-only projectiles)', () => {
    // "Castle wars bolts" ship with +122 ranged_str (dragon-bolt tier) and
    // the arrows with +60, but neither can leave the minigame arena.
    const eq = [
      piece('Castle wars bolts', 122, 0),
      piece('Castle wars arrow', 60, 0),
      piece('Dragon bolts', 122, 0), // control: real bolts untouched
    ];
    patchEquipmentData(eq);
    expect(eq[0].bonuses.ranged_str).toBe(0);
    expect(eq[1].bonuses.ranged_str).toBe(0);
    expect(eq[2].bonuses.ranged_str).toBe(122);
  });

  it('leaves unaffected pieces alone', () => {
    const dragon = piece('Dragon arrow', 60, 0);
    const tbow: EquipmentPiece = { ...piece('Twisted bow', 20, 70), slot: 'weapon', category: 'Bow', isTwoHanded: true };
    patchEquipmentData([dragon, tbow]);
    expect(dragon.bonuses.ranged_str).toBe(60);
    expect(tbow.bonuses.ranged_str).toBe(20);
    expect(tbow.offensive.ranged).toBe(70);
  });

  it('is safe to call on an empty equipment list', () => {
    expect(() => patchEquipmentData([])).not.toThrow();
  });
});
