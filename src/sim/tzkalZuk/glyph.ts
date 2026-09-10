/**
 * The patrolling Ancestral Glyph. Zuk fires from the north; the glyph sits
 * one row south of his footprint and slides east-west across his firing
 * lane. A shot is blocked when the player stands in a column the glyph
 * currently covers AND is south of it (the glyph is between the player and
 * Zuk). Staying protected therefore means shuffling to keep the glyph
 * overhead — the fight's core mechanic.
 *
 * The wiki doesn't publish the tile width or cadence; see constants.ts for
 * the modelled values. Geometry lives here as pure helpers + a tiny stateful
 * patroller so the engine and the (assist-only) safe-tile overlay agree.
 */
import { ARENA_W, GLYPH_ROW, GLYPH_STEP_TICKS, GLYPH_WIDTH } from './constants';
import type { Vec } from './types';

export interface GlyphSpan {
  x0: number;
  x1: number; // exclusive
  row: number;
}

export class Glyph {
  /** Left column of the covered span. */
  x0: number;
  /** +1 (moving east) or -1 (moving west). */
  private dir: 1 | -1 = 1;
  private stepCounter = 0;
  /** Full east↔west patrol cycles completed — gates the first add set. */
  rotations = 0;
  private minX = 0;
  private readonly maxX = ARENA_W - GLYPH_WIDTH;

  constructor(startX = 0) {
    this.x0 = Math.max(0, Math.min(this.maxX, startX));
  }

  span(): GlyphSpan {
    return { x0: this.x0, x1: this.x0 + GLYPH_WIDTH, row: GLYPH_ROW };
  }

  /** Which way the patrol is heading: +1 east, -1 west. Visible in game,
   *  and what tells the player which way to shuffle next. */
  get direction(): 1 | -1 { return this.dir; }

  /**
   * Advance the patrol one tick. `frozen` holds it still (practice).
   *
   * The glyph bounces off each wall without pausing on it. That matters:
   * wiki `Inferno` says "TzKal-Zuk's normal attack cycle and the rotational
   * cycle of the shield align, [so] there are four consistent safespots".
   * A dwell tick at each end would make the patrol 84 ticks and drift out
   * of phase with Zuk's 10-tick attack; bouncing keeps it at exactly
   * 2·(ARENA_W − GLYPH_WIDTH)·GLYPH_STEP_TICKS = 80 ticks = 8 Zuk attacks.
   */
  step(frozen: boolean): void {
    if (frozen) return;
    this.stepCounter++;
    if (this.stepCounter < GLYPH_STEP_TICKS) return;
    this.stepCounter = 0;
    let next = this.x0 + this.dir;
    if (next > this.maxX) { this.dir = -1; next = this.maxX + this.dir; }
    else if (next < this.minX) { this.dir = 1; next = this.minX + this.dir; }
    this.x0 = next;
    // A full there-and-back completes on the return to the west wall.
    if (this.x0 === this.minX && this.dir === -1) this.rotations++;
  }

  /** Is `pos` protected from a north-origin shot by this glyph position? */
  protects(pos: Vec): boolean {
    const s = this.span();
    return pos.x >= s.x0 && pos.x < s.x1 && pos.y < s.row;
  }
}

/** Standalone protection test for a given span (used by the overlay). */
export function spanProtects(span: GlyphSpan, pos: Vec): boolean {
  return pos.x >= span.x0 && pos.x < span.x1 && pos.y < span.row;
}
