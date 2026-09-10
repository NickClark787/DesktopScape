/**
 * Tests for the pure parts of the arena renderer: projection, camera
 * framing, effect pools and the tile-set decoder.
 *
 * None of these touch the DOM — that is the point. The geometry that
 * decides where a tile is drawn, and the decoder that turns the engine's
 * hazard set into drawable tiles, are exactly the places where a visual
 * layer can silently start lying about the fight, so they are unit
 * tested against the engine's own output.
 */
import { describe, expect, it } from 'vitest';
import { ARENA_H, ARENA_W, BOSS_SIZE } from '@sim/solHeredit/constants';
import { aoeHazardTiles, tileKey } from '@sim/solHeredit/hazards';
import type { AoeAttack } from '@sim/solHeredit/types';
import {
  facingScreenDir, windupProgress,
} from '@/colosseum/render/actors';
import {
  FxKind, FxPool, ParticleField, fxProgress,
} from '@/arena/effects';
import {
  fitCamera, makeCamera, project, projectTile, screenToTile, unproject,
  worldHeight, worldWidth, type Camera, type Point,
} from '@/arena/projection';
import { TileMask, TileSetCache, numStr } from '@/arena/shapes';
import { QUALITY, lowerTier, visualAidsInUse, DEFAULT_GRAPHICS } from '@/arena/options';
import type { SimSnapshot } from '@sim/solHeredit/types';

const OUT: Point = { x: 0, y: 0 };

function fitted(mode: 'iso' | 'tactical', zoom = 1, w = 900, h = 560): Camera {
  const cam = makeCamera(ARENA_W, ARENA_H);
  return fitCamera(cam, { canvasW: w, canvasH: h, mode, zoom, focus: null, required: null });
}

describe('projection', () => {
  it('round-trips every tile back to itself in isometric mode', () => {
    const cam = fitted('iso');
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        projectTile(cam, x, y, OUT);
        const sx = OUT.x;
        const sy = OUT.y;
        const tile = screenToTile(cam, sx, sy, OUT);
        expect(tile).not.toBeNull();
        expect([tile!.x, tile!.y]).toEqual([x, y]);
      }
    }
  });

  it('round-trips every tile back to itself in tactical mode', () => {
    const cam = fitted('tactical');
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        projectTile(cam, x, y, OUT);
        const tile = screenToTile(cam, OUT.x, OUT.y, OUT);
        expect(tile).not.toBeNull();
        expect([tile!.x, tile!.y]).toEqual([x, y]);
      }
    }
  });

  it('rejects clicks outside the playable box', () => {
    const cam = fitted('iso');
    projectTile(cam, 0, 0, OUT);
    // Two tiles further south-west than the corner tile is off the floor.
    expect(screenToTile(cam, OUT.x - 200, OUT.y + 200, OUT)).toBeNull();
  });

  it('puts north up-screen, so Sol at the north wall sits above the player', () => {
    const cam = fitted('iso');
    projectTile(cam, 8, ARENA_H - 3, OUT); // boss centre, north wall
    const bossY = OUT.y;
    projectTile(cam, 8, 4, OUT);           // player spawn, south
    expect(bossY).toBeLessThan(OUT.y);
  });

  it('keeps east to the right of west at the same latitude', () => {
    const cam = fitted('iso');
    projectTile(cam, 2, 7, OUT);
    const westX = OUT.x;
    projectTile(cam, 13, 7, OUT);
    expect(westX).toBeLessThan(OUT.x);
  });

  it('unproject is the exact inverse of project', () => {
    const cam = fitted('iso', 1.4);
    for (const [a, b] of [[0, 0], [3.5, 9.25], [ARENA_W, ARENA_H], [7.5, 0.5]]) {
      project(cam, a, b, OUT);
      unproject(cam, OUT.x, OUT.y, OUT);
      expect(OUT.x).toBeCloseTo(a, 6);
      expect(OUT.y).toBeCloseTo(b, 6);
    }
  });

  it('fits the whole arena inside the canvas at zoom 1', () => {
    const w = 900;
    const h = 560;
    const cam = fitted('iso', 1, w, h);
    for (const [a, b] of [[0, 0], [ARENA_W, 0], [ARENA_W, ARENA_H], [0, ARENA_H]]) {
      project(cam, a, b, OUT);
      expect(OUT.x).toBeGreaterThanOrEqual(0);
      expect(OUT.x).toBeLessThanOrEqual(w);
      expect(OUT.y).toBeGreaterThanOrEqual(0);
      expect(OUT.y).toBeLessThanOrEqual(h);
    }
  });

  it('reduces zoom until the must-see rect fits — a hazard is never framed out', () => {
    const w = 640;
    const h = 400;
    const cam = makeCamera(ARENA_W, ARENA_H);
    // Ask for an absurd zoom while requiring the whole arena on screen.
    fitCamera(cam, {
      canvasW: w, canvasH: h, mode: 'iso', zoom: 6, focus: { x: 2, y: 2 },
      required: { a0: 0, b0: 0, a1: ARENA_W, b1: ARENA_H },
    });
    const unclamped = makeCamera(ARENA_W, ARENA_H);
    fitCamera(unclamped, {
      canvasW: w, canvasH: h, mode: 'iso', zoom: 6, focus: null, required: null,
    });
    expect(cam.scale).toBeLessThan(unclamped.scale);
    // And the required span really does fit.
    expect(worldWidth('iso', ARENA_W, ARENA_H) * cam.scale).toBeLessThanOrEqual(w);
    expect(worldHeight('iso', ARENA_W, ARENA_H) * cam.scale).toBeLessThanOrEqual(h);
  });

  it('never returns a degenerate scale for a tiny canvas', () => {
    const cam = fitted('iso', 1, 60, 40);
    expect(cam.scale).toBeGreaterThan(0);
    expect(Number.isFinite(cam.scale)).toBe(true);
  });
});

describe('facing', () => {
  it('maps the four cardinals to four distinct screen directions', () => {
    const cam = fitted('iso');
    const seen = new Set<string>();
    for (const [fx, fy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      facingScreenDir(cam, fx, fy, OUT);
      expect(Math.hypot(OUT.x, OUT.y)).toBeCloseTo(1, 6);
      seen.add(`${OUT.x.toFixed(3)},${OUT.y.toFixed(3)}`);
    }
    expect(seen.size).toBe(4);
  });

  it('points north up-screen', () => {
    const cam = fitted('iso');
    facingScreenDir(cam, 0, 1, OUT);
    expect(OUT.y).toBeLessThan(0);
  });
});

describe('wind-up progress', () => {
  const base = {
    bossAttack: 'spear1', bossAttackDeclareTick: 10, bossAttackResolveTick: 11,
  } as unknown as SimSnapshot;

  it('runs 0 → 1 across the declare/resolve span', () => {
    expect(windupProgress(base, 10)).toBe(0);
    expect(windupProgress(base, 10.5)).toBeCloseTo(0.5, 6);
    expect(windupProgress(base, 11)).toBe(1);
  });

  it('clamps outside the span and reports nothing when idle', () => {
    expect(windupProgress(base, 20)).toBe(1);
    expect(windupProgress(base, 0)).toBe(0);
    const idle = { bossAttack: null, bossAttackDeclareTick: -1, bossAttackResolveTick: -1 } as unknown as SimSnapshot;
    expect(windupProgress(idle, 5)).toBe(0);
  });
});

describe('FxPool', () => {
  it('hands out distinct slots without growing the backing array', () => {
    const pool = new FxPool(4);
    const seen = new Set<unknown>();
    for (let i = 0; i < 4; i++) seen.add(pool.spawn());
    expect(seen.size).toBe(4);
    expect(pool.items.length).toBe(4);
    expect(pool.liveCount).toBe(4);
  });

  it('recycles the oldest slot when saturated', () => {
    const pool = new FxPool(3);
    const first = pool.spawn();
    first.text = 'oldest';
    pool.spawn();
    pool.spawn();
    const recycled = pool.spawn();
    expect(recycled).toBe(first);
    expect(recycled.text).toBe(''); // reset on reuse
    expect(pool.items.length).toBe(3);
  });

  it('respects the quality cap and retires effects parked beyond it', () => {
    const pool = new FxPool(8);
    for (let i = 0; i < 8; i++) pool.spawn();
    expect(pool.liveCount).toBe(8);
    // A downgrade to a 2-effect budget must not leave 6 stale effects drawn.
    pool.spawn(2);
    expect(pool.liveCount).toBeLessThanOrEqual(2);
  });

  it('expires effects once their lifetime elapses', () => {
    const pool = new FxPool(2);
    const fx = pool.spawn();
    fx.life = 100;
    pool.update(60);
    expect(fx.active).toBe(true);
    pool.update(60);
    expect(fx.active).toBe(false);
    expect(pool.liveCount).toBe(0);
  });

  it('freezes effects at their peak pose when the loop is not animating', () => {
    const pool = new FxPool(1);
    const fx = pool.spawn();
    fx.kind = FxKind.Hitsplat;
    fx.life = 1000;
    fx.age = 900;
    fx.peak = 0.35;
    expect(fxProgress(fx, true)).toBeCloseTo(0.9, 6);
    expect(fxProgress(fx, false)).toBe(0.35);
  });

  it('clear deactivates everything', () => {
    const pool = new FxPool(4);
    pool.spawn();
    pool.spawn();
    pool.clear();
    expect(pool.liveCount).toBe(0);
  });
});

describe('ParticleField', () => {
  it('stores particles in typed arrays and ages them out', () => {
    const pf = new ParticleField(4);
    pf.emit(1, 2, 0.5, 0, 10, 100, 0, 0.1, 4);
    expect(pf.liveCount).toBe(1);
    expect(pf.a[0]).toBe(1);
    pf.update(50);
    expect(pf.a[0]).toBeGreaterThan(1); // moved along its velocity
    pf.update(60);
    expect(pf.liveCount).toBe(0);
  });

  it('honours the per-tier limit rather than the capacity', () => {
    const pf = new ParticleField(16);
    for (let i = 0; i < 12; i++) pf.emit(0, 0, 0, 0, 0, 500, 0, 0.1, 3);
    expect(pf.liveCount).toBeLessThanOrEqual(3);
  });

  it('clear resets the field', () => {
    const pf = new ParticleField(4);
    pf.emit(0, 0, 0, 0, 0, 500, 0, 0.1, 4);
    pf.clear();
    expect(pf.liveCount).toBe(0);
  });
});

describe('TileSetCache', () => {
  it('decodes the engine hazard set tile-for-tile, for every AoE', () => {
    const anchor = { x: 5, y: 9 };
    const player = { x: 7, y: 4 };
    const cache = new TileSetCache(ARENA_W * ARENA_H);
    for (const attack of ['spear1', 'spear2', 'shield1', 'shield2'] as AoeAttack[]) {
      const engineSet = aoeHazardTiles(attack, anchor, player);
      cache.invalidate();
      cache.sync(engineSet);
      expect(cache.count).toBe(engineSet.size);
      const decoded = new Set<string>();
      for (let i = 0; i < cache.count; i++) decoded.add(tileKey(cache.xs[i], cache.ys[i]));
      expect(decoded).toEqual(engineSet);
    }
  });

  it('re-decodes when the set grows, and skips the work when it has not', () => {
    const cache = new TileSetCache(ARENA_W * ARENA_H);
    const sand = new Set<string>([tileKey(1, 1)]);
    cache.sync(sand);
    expect(cache.count).toBe(1);
    cache.sync(sand);
    expect(cache.count).toBe(1);
    sand.add(tileKey(2, 3));
    cache.sync(sand);
    expect(cache.count).toBe(2);
    expect(cache.has(2, 3)).toBe(true);
    expect(cache.has(9, 9)).toBe(false);
  });

  it('handles a null set as empty', () => {
    const cache = new TileSetCache(ARENA_W * ARENA_H);
    cache.sync(new Set([tileKey(4, 4)]));
    cache.sync(null);
    expect(cache.count).toBe(0);
  });
});

describe('TileMask', () => {
  it('answers membership in O(1) and resets without clearing memory', () => {
    const mask = new TileMask(ARENA_W, ARENA_H);
    const cache = new TileSetCache(ARENA_W * ARENA_H);
    cache.sync(new Set([tileKey(0, 0), tileKey(ARENA_W - 1, ARENA_H - 1)]));
    mask.fromCache(cache);
    expect(mask.has(0, 0)).toBe(true);
    expect(mask.has(ARENA_W - 1, ARENA_H - 1)).toBe(true);
    expect(mask.has(3, 3)).toBe(false);
    expect(mask.has(-1, 0)).toBe(false);
    expect(mask.has(ARENA_W, 0)).toBe(false);
    mask.reset();
    expect(mask.has(0, 0)).toBe(false);
  });
});

describe('quality tiers', () => {
  it('makes low genuinely cheap, not merely less sparkly', () => {
    const low = QUALITY.low;
    expect(low.maxParticles).toBe(0);
    expect(low.glows).toBe(false);
    expect(low.shadows).toBe(false);
    expect(low.richArena).toBe(false);
    expect(low.interpolate).toBe(false);
    expect(low.maxDpr).toBe(1);
  });

  it('orders the tiers monotonically by cost', () => {
    expect(QUALITY.low.maxParticles).toBeLessThan(QUALITY.medium.maxParticles);
    expect(QUALITY.medium.maxParticles).toBeLessThan(QUALITY.high.maxParticles);
    expect(QUALITY.low.maxDpr).toBeLessThanOrEqual(QUALITY.medium.maxDpr);
    expect(QUALITY.medium.maxDpr).toBeLessThanOrEqual(QUALITY.high.maxDpr);
  });

  it('steps down one tier at a time and stops at low', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
  });
});

describe('honest reporting', () => {
  it('reports no visual aids for the default settings', () => {
    expect(visualAidsInUse(DEFAULT_GRAPHICS)).toEqual([]);
  });

  it('reports the tile grid and the tactical view as aids', () => {
    const aids = visualAidsInUse({ ...DEFAULT_GRAPHICS, showTileCoords: true, view: 'tactical' });
    expect(aids).toContain('tile coordinates');
    expect(aids).toContain('tactical top-down view');
  });
});

describe('numStr', () => {
  it('returns the same string instance for repeated small integers', () => {
    expect(numStr(0)).toBe('0');
    expect(numStr(44)).toBe('44');
    expect(numStr(44)).toBe(numStr(44));
    expect(numStr(9999)).toBe('9999');
  });
});

describe('boss footprint geometry', () => {
  it('centres the 5x5 boss on its anchor + 2 in both axes', () => {
    const cam = fitted('iso');
    const anchor = { x: 5, y: 9 };
    projectTile(cam, anchor.x + 2, anchor.y + 2, OUT);
    const cx = OUT.x;
    // The centre tile is equidistant from the west and east footprint edges.
    projectTile(cam, anchor.x, anchor.y + 2, OUT);
    const westX = OUT.x;
    projectTile(cam, anchor.x + BOSS_SIZE - 1, anchor.y + 2, OUT);
    const eastX = OUT.x;
    expect(cx - westX).toBeCloseTo(eastX - cx, 6);
  });
});
