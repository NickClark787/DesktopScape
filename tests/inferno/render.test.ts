/**
 * Tests for the pure parts of the Inferno renderer.
 *
 * Two things matter most here and both are checked against the engine's
 * own code rather than against a hand-written expectation:
 *  - the glyph's sheltered tiles must be exactly the set `spanProtects`
 *    returns true for, because drawing a safe tile the engine calls
 *    exposed is the worst lie this layer could tell;
 *  - the shared projection must address the Inferno's 25×18 platform as
 *    correctly as it does the Colosseum's 16×15 box.
 */
import { describe, expect, it } from 'vitest';
import {
  ARENA_H, ARENA_W, GLYPH_ROW, GLYPH_WIDTH, ZUK_ATTACK_DELAY, ZUK_SIZE,
} from '@sim/tzkalZuk/constants';
import { Glyph, spanProtects } from '@sim/tzkalZuk/glyph';
import type { SimSnapshot } from '@sim/tzkalZuk/types';
import { chargeProgress, zukCentre, ZUK_UNIT } from '@/inferno/render/actors';
import { glyphSafeTiles } from '@/inferno/render/overlay';
import {
  fitCamera, makeCamera, projectTile, screenToTile, worldHeight, worldWidth,
  type Camera, type Point,
} from '@/arena/projection';

const OUT: Point = { x: 0, y: 0 };
const XS = new Int16Array(ARENA_W * ARENA_H);
const YS = new Int16Array(ARENA_W * ARENA_H);

function fitted(mode: 'iso' | 'tactical', zoom = 1, w = 900, h = 560): Camera {
  const cam = makeCamera(ARENA_W, ARENA_H);
  return fitCamera(cam, { canvasW: w, canvasH: h, mode, zoom, focus: null, required: null });
}

describe('projection on the 25x18 platform', () => {
  it('round-trips every tile back to itself in isometric mode', () => {
    const cam = fitted('iso');
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        projectTile(cam, x, y, OUT);
        const tile = screenToTile(cam, OUT.x, OUT.y, OUT);
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

  it('carries its own grid size, so the two arenas cannot alias', () => {
    const inferno = fitted('iso');
    const colosseum = makeCamera(16, 15);
    expect(inferno.gw).toBe(ARENA_W);
    expect(inferno.gh).toBe(ARENA_H);
    expect(colosseum.gw).toBe(16);
    // Same tile index, different arena → different grid row, so the two
    // never share a projection by accident.
    projectTile(inferno, 0, 0, OUT);
    const infernoY = OUT.y;
    fitCamera(colosseum, {
      canvasW: 900, canvasH: 560, mode: 'iso', zoom: 1, focus: null, required: null,
    });
    projectTile(colosseum, 0, 0, OUT);
    expect(infernoY).not.toBeCloseTo(OUT.y, 3);
  });

  it('puts Zuk at the north wall above the player spawn', () => {
    const cam = fitted('iso');
    projectTile(cam, 12, ARENA_H - 4, OUT); // Zuk's centre row
    const zukY = OUT.y;
    projectTile(cam, 12, 2, OUT);           // player spawn
    expect(zukY).toBeLessThan(OUT.y);
  });

  it('fits the whole platform inside the canvas at zoom 1', () => {
    const w = 900;
    const h = 560;
    const cam = fitted('iso', 1, w, h);
    expect(worldWidth('iso', ARENA_W, ARENA_H) * cam.scale).toBeLessThanOrEqual(w);
    expect(worldHeight('iso', ARENA_W, ARENA_H) * cam.scale).toBeLessThanOrEqual(h);
  });
});

describe('glyph shelter', () => {
  it('draws exactly the tiles the engine calls protected, across a patrol', () => {
    const glyph = new Glyph(0);
    // Walk a full patrol so both directions and both walls are covered.
    for (let step = 0; step < 120; step++) {
      glyph.step(false);
      const span = glyph.span();
      const n = glyphSafeTiles(span, XS, YS);

      const drawn = new Set<string>();
      for (let i = 0; i < n; i++) drawn.add(`${XS[i]},${YS[i]}`);

      const expected = new Set<string>();
      for (let x = 0; x < ARENA_W; x++) {
        for (let y = 0; y < ARENA_H; y++) {
          if (spanProtects(span, { x, y })) expected.add(`${x},${y}`);
        }
      }
      expect(drawn).toEqual(expected);
    }
  });

  it('shelters exactly GLYPH_WIDTH columns, every row south of the bar', () => {
    const span = { x0: 7, x1: 7 + GLYPH_WIDTH, row: GLYPH_ROW };
    const n = glyphSafeTiles(span, XS, YS);
    expect(n).toBe(GLYPH_WIDTH * GLYPH_ROW);
    for (let i = 0; i < n; i++) {
      expect(XS[i]).toBeGreaterThanOrEqual(7);
      expect(XS[i]).toBeLessThan(7 + GLYPH_WIDTH);
      expect(YS[i]).toBeLessThan(GLYPH_ROW);
    }
  });

  it('never reports a tile north of the bar as sheltered', () => {
    const span = { x0: 0, x1: GLYPH_WIDTH, row: GLYPH_ROW };
    const n = glyphSafeTiles(span, XS, YS);
    for (let i = 0; i < n; i++) expect(YS[i]).toBeLessThan(span.row);
    expect(spanProtects(span, { x: 1, y: GLYPH_ROW })).toBe(false);
    expect(spanProtects(span, { x: 1, y: GLYPH_ROW - 1 })).toBe(true);
  });
});

describe('Zuk charge', () => {
  const base = {
    zukWindupStartTick: 10,
    zukWindupLandTick: 10 + ZUK_ATTACK_DELAY,
  } as unknown as SimSnapshot;

  it('runs 0 → 1 across the declared charge', () => {
    expect(chargeProgress(base, 10)).toBe(0);
    expect(chargeProgress(base, 10 + ZUK_ATTACK_DELAY / 2)).toBeCloseTo(0.5, 6);
    expect(chargeProgress(base, 10 + ZUK_ATTACK_DELAY)).toBe(1);
  });

  it('clamps outside the window and reports nothing when idle', () => {
    expect(chargeProgress(base, 99)).toBe(1);
    expect(chargeProgress(base, 0)).toBe(0);
    const idle = { zukWindupStartTick: -1, zukWindupLandTick: -1 } as unknown as SimSnapshot;
    expect(chargeProgress(idle, 5)).toBe(0);
  });

  it('falls back to the constant delay if only the land tick is known', () => {
    const partial = { zukWindupStartTick: -1, zukWindupLandTick: 20 } as unknown as SimSnapshot;
    expect(chargeProgress(partial, 20 - ZUK_ATTACK_DELAY)).toBe(0);
    expect(chargeProgress(partial, 20)).toBe(1);
  });
});

describe('Zuk framing', () => {
  it('centres him on his 7x7 footprint', () => {
    const cam = fitted('iso');
    const anchor = { x: Math.floor((ARENA_W - ZUK_SIZE) / 2), y: ARENA_H - ZUK_SIZE };
    const s = { zukAnchor: anchor, zukSize: ZUK_SIZE } as unknown as SimSnapshot;
    zukCentre(s, cam, OUT);
    const cx = OUT.x;
    projectTile(cam, anchor.x, anchor.y + 3, OUT);
    const westX = OUT.x;
    projectTile(cam, anchor.x + ZUK_SIZE - 1, anchor.y + 3, OUT);
    const eastX = OUT.x;
    expect(cx - westX).toBeCloseTo(eastX - cx, 6);
  });

  it('scales his art above the player marker, as a 7x7 boss should', () => {
    expect(ZUK_UNIT).toBeGreaterThan(1.5);
  });
});
