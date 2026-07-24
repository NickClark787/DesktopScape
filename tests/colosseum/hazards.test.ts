/**
 * Hazard geometry — asserts the documented dodge tiles for each AoE are
 * actually safe, and the documented punish tiles are hazardous.
 * Boss anchor (5,8) → centre (7,10); player south at (7,5) → facing (0,-1).
 * Tile (7+lat, 10-forward) is `forward` in front / `lat` beside the centre.
 */
import { describe, expect, it } from 'vitest';
import { aoeHazardTiles, distToBoss, facingToward, tileKey } from '@sim/solHeredit/hazards';

const anchor = { x: 5, y: 8 };
const player = { x: 7, y: 5 };

describe('facing / distance helpers', () => {
  it('faces the player along the dominant axis', () => {
    expect(facingToward(anchor, player)).toEqual({ x: 0, y: -1 });
    expect(facingToward(anchor, { x: 14, y: 10 })).toEqual({ x: 1, y: 0 });
  });

  it('distToBoss is 0 under the boss and Chebyshev outside', () => {
    expect(distToBoss(anchor, 7, 10)).toBe(0);
    expect(distToBoss(anchor, 7, 7)).toBe(1); // adjacent south of bbox y8
    expect(distToBoss(anchor, 4, 7)).toBe(1);
  });
});

describe('Spear 1 (5x6 + two off-centre lines)', () => {
  const tiles = aoeHazardTiles('spear1', anchor, player);

  it('covers the boss, the front row, and the ±1 lines', () => {
    expect(tiles.has(tileKey(7, 10))).toBe(true); // under boss
    expect(tiles.has(tileKey(7, 7))).toBe(true); // front row centre (melee tile)
    expect(tiles.has(tileKey(6, 6))).toBe(true); // line, lateral -1
    expect(tiles.has(tileKey(8, 6))).toBe(true); // line, lateral +1
  });

  it('is dodged 1 tile back from his centre or corner tiles', () => {
    expect(tiles.has(tileKey(7, 6))).toBe(false); // 1 back from centre
    expect(tiles.has(tileKey(5, 6))).toBe(false); // 1 back from west corner
    expect(tiles.has(tileKey(9, 6))).toBe(false); // 1 back from east corner
  });
});

describe('Spear 2 (5x5 + three centre/corner lines)', () => {
  const tiles = aoeHazardTiles('spear2', anchor, player);

  it('covers the centre and corner lines', () => {
    expect(tiles.has(tileKey(7, 7))).toBe(true); // centre line
    expect(tiles.has(tileKey(5, 7))).toBe(true); // west corner line
    expect(tiles.has(tileKey(9, 7))).toBe(true); // east corner line
  });

  it('is dodged on the off-centre tiles', () => {
    expect(tiles.has(tileKey(6, 7))).toBe(false);
    expect(tiles.has(tileKey(8, 7))).toBe(false);
    expect(tiles.has(tileKey(6, 6))).toBe(false); // 1 back diagonal
    expect(tiles.has(tileKey(8, 6))).toBe(false);
  });
});

describe('Shield slams (safe rings)', () => {
  it('Shield 1: safe exactly on the 9x9 perimeter (1 tile back)', () => {
    const tiles = aoeHazardTiles('shield1', anchor, player);
    expect(tiles.has(tileKey(7, 7))).toBe(true); // melee range — hit
    expect(tiles.has(tileKey(7, 6))).toBe(false); // 1 back — safe
    expect(tiles.has(tileKey(3, 10))).toBe(false); // ring extends all around
    expect(tiles.has(tileKey(7, 5))).toBe(true); // 2 back — hit again
    expect(tiles.has(tileKey(7, 10))).toBe(true); // under boss
  });

  it('Shield 2: safe exactly on the 11x11 perimeter (2 tiles back)', () => {
    const tiles = aoeHazardTiles('shield2', anchor, player);
    expect(tiles.has(tileKey(7, 6))).toBe(true); // 1 back — hit
    expect(tiles.has(tileKey(7, 5))).toBe(false); // 2 back — safe
    expect(tiles.has(tileKey(2, 10))).toBe(false);
    expect(tiles.has(tileKey(7, 4))).toBe(true); // 3 back — hit
  });
});
