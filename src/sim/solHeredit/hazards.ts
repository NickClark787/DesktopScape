/**
 * Hazard geometry for Sol Heredit's four AoE attacks, on the 16x15 arena
 * grid. All shapes are pure functions of the boss anchor + player position
 * (facing is derived), returning tile-key sets the engine resolves 1 tick
 * later.
 *
 * Shapes follow the spec's tile counts; the safe tiles they leave match
 * the wiki's documented dodges (unit-tested in tests/colosseum):
 *  - Spear 1: 5x6 under/in front + two 4x1 lines at the off-centre
 *    columns → safe 1 tile back from his centre or corner tiles.
 *  - Spear 2: 5x5 under him + three 4x1 lines at centre/corner columns →
 *    safe on/behind his off-centre tiles.
 *  - Shield 1: everything except the 9x9 perimeter ring (1 tile back
 *    from melee range).
 *  - Shield 2: everything except the 11x11 perimeter ring (2 tiles back).
 */
import { ARENA_H, ARENA_W, BOSS_SIZE } from './constants';
import type { AoeAttack, Vec } from './types';

export const tileKey = (x: number, y: number): string => `${x},${y}`;

export function inArena(x: number, y: number): boolean {
  return x >= 0 && x < ARENA_W && y >= 0 && y < ARENA_H;
}

export function bossCenter(anchor: Vec): Vec {
  return { x: anchor.x + 2, y: anchor.y + 2 };
}

export function underBoss(anchor: Vec, x: number, y: number): boolean {
  return x >= anchor.x && x < anchor.x + BOSS_SIZE && y >= anchor.y && y < anchor.y + BOSS_SIZE;
}

/** Chebyshev distance from a tile to the boss's 5x5 bounding box (0 = under). */
export function distToBoss(anchor: Vec, x: number, y: number): number {
  const dx = Math.max(anchor.x - x, 0, x - (anchor.x + BOSS_SIZE - 1));
  const dy = Math.max(anchor.y - y, 0, y - (anchor.y + BOSS_SIZE - 1));
  return Math.max(dx, dy);
}

/** Cardinal facing from the boss centre toward the player. Ties pick x. */
export function facingToward(anchor: Vec, player: Vec): Vec {
  const c = bossCenter(anchor);
  const dx = player.x - c.x;
  const dy = player.y - c.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx) || 1, y: 0 };
  return { x: 0, y: Math.sign(dy) };
}

/** Tile at `forward` steps in front of the centre and `lateral` steps to
 *  the side (perpendicular), given a cardinal facing. */
function offsetTile(c: Vec, f: Vec, forward: number, lateral: number): Vec {
  // Perpendicular of (fx, fy) is (-fy, fx).
  return { x: c.x + f.x * forward - f.y * lateral, y: c.y + f.y * forward + f.x * lateral };
}

function addIfIn(set: Set<string>, v: Vec): void {
  if (inArena(v.x, v.y)) set.add(tileKey(v.x, v.y));
}

/** Spear 1: boss 5x5 + the full row directly in front (5x6 total), plus
 *  two 4-tile lines along the ±1 lateral columns. Centre column and the
 *  ±2 (corner) columns are clear beyond the front row. */
function spear1Tiles(anchor: Vec, player: Vec): Set<string> {
  const out = new Set<string>();
  const c = bossCenter(anchor);
  const f = facingToward(anchor, player);
  for (let fw = -2; fw <= 3; fw++) {
    for (let lat = -2; lat <= 2; lat++) addIfIn(out, offsetTile(c, f, fw, lat));
  }
  for (const lat of [-1, 1]) {
    for (let fw = 4; fw <= 7; fw++) addIfIn(out, offsetTile(c, f, fw, lat));
  }
  return out;
}

/** Spear 2: boss 5x5 plus three 4-tile lines along the centre and ±2
 *  (corner) columns, starting at the front edge. The ±1 off-centre
 *  columns stay clear — the documented dodge. */
function spear2Tiles(anchor: Vec, player: Vec): Set<string> {
  const out = new Set<string>();
  const c = bossCenter(anchor);
  const f = facingToward(anchor, player);
  for (let fw = -2; fw <= 2; fw++) {
    for (let lat = -2; lat <= 2; lat++) addIfIn(out, offsetTile(c, f, fw, lat));
  }
  for (const lat of [-2, 0, 2]) {
    for (let fw = 3; fw <= 6; fw++) addIfIn(out, offsetTile(c, f, fw, lat));
  }
  return out;
}

/** Shield slams: the whole arena is dangerous except a square safe ring
 *  around the boss — the 9x9 perimeter (shield 1, 1 tile back from melee)
 *  or the 11x11 perimeter (shield 2, 2 tiles back). Distances are from
 *  the boss centre; melee range sits at Chebyshev 3 for a 5x5 boss. */
function shieldTiles(anchor: Vec, safeChebyshev: number): Set<string> {
  const out = new Set<string>();
  const c = bossCenter(anchor);
  for (let x = 0; x < ARENA_W; x++) {
    for (let y = 0; y < ARENA_H; y++) {
      const d = Math.max(Math.abs(x - c.x), Math.abs(y - c.y));
      if (d !== safeChebyshev) out.add(tileKey(x, y));
    }
  }
  return out;
}

export function aoeHazardTiles(attack: AoeAttack, anchor: Vec, player: Vec): Set<string> {
  switch (attack) {
    case 'spear1': return spear1Tiles(anchor, player);
    case 'spear2': return spear2Tiles(anchor, player);
    case 'shield1': return shieldTiles(anchor, 4);
    case 'shield2': return shieldTiles(anchor, 5);
  }
}
