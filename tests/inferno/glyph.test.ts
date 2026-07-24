/**
 * Ancestral Glyph patrol + protection geometry. Zuk fires from the north;
 * the glyph one row south blocks shots to the columns it covers for players
 * south of it.
 */
import { describe, expect, it } from 'vitest';
import { Glyph, spanProtects } from '@sim/tzkalZuk/glyph';
import { ARENA_W, GLYPH_ROW, GLYPH_STEP_TICKS, GLYPH_WIDTH } from '@sim/tzkalZuk/constants';

describe('Glyph patrol', () => {
  it('covers GLYPH_WIDTH columns at the glyph row', () => {
    const g = new Glyph(3);
    expect(g.span()).toEqual({ x0: 3, x1: 3 + GLYPH_WIDTH, row: GLYPH_ROW });
  });

  it('steps one tile every GLYPH_STEP_TICKS ticks', () => {
    const g = new Glyph(0);
    for (let i = 0; i < GLYPH_STEP_TICKS; i++) {
      expect(g.x0).toBe(0);
      g.step(false);
    }
    expect(g.x0).toBe(1);
  });

  it('does not move while frozen', () => {
    const g = new Glyph(0);
    for (let i = 0; i < 20; i++) g.step(true);
    expect(g.x0).toBe(0);
  });

  it('reverses at the walls and counts a rotation on the west return', () => {
    const g = new Glyph(0);
    const maxX = ARENA_W - GLYPH_WIDTH;
    // Run enough ticks for a full there-and-back.
    let guard = 0;
    while (g.rotations < 1 && guard++ < 10000) g.step(false);
    expect(g.rotations).toBe(1);
    expect(g.x0).toBe(0); // back at the west wall
    // It never leaves the arena bounds.
    for (let i = 0; i < 500; i++) {
      g.step(false);
      expect(g.x0).toBeGreaterThanOrEqual(0);
      expect(g.x0).toBeLessThanOrEqual(maxX);
    }
  });
});

describe('Glyph protection', () => {
  it('protects a player in a covered column south of the glyph', () => {
    const g = new Glyph(5); // covers x 5..9
    expect(g.protects({ x: 5, y: GLYPH_ROW - 1 })).toBe(true);
    expect(g.protects({ x: 9, y: 0 })).toBe(true);
  });

  it('does not protect outside the covered columns', () => {
    const g = new Glyph(5);
    expect(g.protects({ x: 4, y: 0 })).toBe(false);
    expect(g.protects({ x: 10, y: 0 })).toBe(false);
  });

  it('does not protect a player north of (level with) the glyph', () => {
    const g = new Glyph(5);
    expect(g.protects({ x: 6, y: GLYPH_ROW })).toBe(false);
    expect(g.protects({ x: 6, y: GLYPH_ROW + 1 })).toBe(false);
  });

  it('spanProtects matches the class method', () => {
    const g = new Glyph(7);
    const span = g.span();
    expect(spanProtects(span, { x: 8, y: 0 })).toBe(g.protects({ x: 8, y: 0 }));
    expect(spanProtects(span, { x: 1, y: 0 })).toBe(g.protects({ x: 1, y: 0 }));
  });
});
