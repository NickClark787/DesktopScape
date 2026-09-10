/**
 * Low-level canvas helpers shared by every arena draw routine.
 *
 * Two rules hold everywhere:
 *  1. Nothing allocates per frame. Points are written into module-level
 *     scratch objects; tile sets are decoded into pre-sized typed arrays
 *     that only rebuild when the underlying set actually changes.
 *  2. Batched shapes go into ONE path and get ONE fill. A shield slam
 *     covers ~230 tiles; that must cost one draw call, not 230.
 */
import { project, type Camera, type Point } from './projection';

export const P0: Point = { x: 0, y: 0 };
export const P1: Point = { x: 0, y: 0 };
export const P2: Point = { x: 0, y: 0 };
export const P3: Point = { x: 0, y: 0 };

/**
 * Add one tile's outline to the path.
 *
 * All four corners are projected rather than two, because under an
 * orbited camera a tile is a general parallelogram — only at the default
 * yaw is it the familiar diamond, and only in tactical mode is it an
 * axis-aligned square. Projecting the corners is correct in every case
 * and costs four multiply-adds.
 */
export function tilePath(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, inset = 0): void {
  const a0 = x + inset;
  const a1 = x + 1 - inset;
  const b0 = cam.gh - 1 - y + inset;
  const b1 = cam.gh - y - inset;
  project(cam, a0, b0, P0);
  project(cam, a1, b0, P1);
  project(cam, a1, b1, P2);
  project(cam, a0, b1, P3);
  ctx.moveTo(P0.x, P0.y);
  ctx.lineTo(P1.x, P1.y);
  ctx.lineTo(P2.x, P2.y);
  ctx.lineTo(P3.x, P3.y);
  ctx.closePath();
}

/** Add an inclusive tile rect (x0..x1, y0..y1) to the path. */
export function areaPath(
  ctx: CanvasRenderingContext2D, cam: Camera,
  x0: number, y0: number, x1: number, y1: number,
): void {
  const a0 = x0;
  const a1 = x1 + 1;
  const b0 = cam.gh - 1 - y1;
  const b1 = cam.gh - y0;
  project(cam, a0, b0, P0);
  project(cam, a1, b0, P1);
  project(cam, a1, b1, P2);
  project(cam, a0, b1, P3);
  ctx.moveTo(P0.x, P0.y);
  ctx.lineTo(P1.x, P1.y);
  ctx.lineTo(P2.x, P2.y);
  ctx.lineTo(P3.x, P3.y);
  ctx.closePath();
}

export function fillTile(
  ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, fill: string, inset = 0,
): void {
  ctx.beginPath();
  tilePath(ctx, cam, x, y, inset);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function fillArea(
  ctx: CanvasRenderingContext2D, cam: Camera,
  x0: number, y0: number, x1: number, y1: number, fill: string,
): void {
  ctx.beginPath();
  areaPath(ctx, cam, x0, y0, x1, y1);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Flattened ellipse used for ground shadows and glow pools.
 *
 * `flat` is the camera's ground compression (1 at the default pitch): a
 * circle on the floor stays an axis-aligned ellipse under any yaw, and
 * only its height changes as the camera tilts, so scaling `ry` is the
 * whole correction.
 */
export function groundEllipse(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number,
  fill: string, flat = 1,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry * flat, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Squash everything drawn until `endUpright` vertically about the ground
 * point `gy`, by the camera's `up` factor.
 *
 * Upright art — a standing boss, a pillar, a spectator — is drawn in
 * screen space from its ground anchor, so a pitching camera should
 * shorten it. Doing that with one context transform keeps every piece of
 * art unchanged and costs a single matrix push per actor.
 *
 * Returns whether a transform was pushed; hand that to `endUpright`.
 */
export function beginUpright(ctx: CanvasRenderingContext2D, gy: number, up: number): boolean {
  if (up > 0.999 && up < 1.001) return false;
  ctx.save();
  // y' = up·y + gy·(1 - up): scales about gy, leaving the feet planted.
  ctx.transform(1, 0, 0, up, 0, gy * (1 - up));
  return true;
}

export function endUpright(ctx: CanvasRenderingContext2D, pushed: boolean): void {
  if (pushed) ctx.restore();
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * Small-integer → string without allocating. `String(n)` in a draw loop
 * allocates once per call per frame; this table covers every number the
 * arenas actually print (damage, countdowns, tick offsets).
 */
const NUM_STRINGS: string[] = [];
for (let i = 0; i <= 400; i++) NUM_STRINGS.push(String(i));

export function numStr(n: number): string {
  const i = n | 0;
  return i >= 0 && i < NUM_STRINGS.length ? NUM_STRINGS[i] : String(i);
}

/** Text with a dark outline — legible over sand, lava, hazards and bars. */
export function outlinedText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  fill: string, font: string, align: CanvasTextAlign = 'center',
): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * Deterministic per-tile noise — no RNG state, no allocation, and stable
 * across re-bakes so floor grain never shimmers between frames.
 */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Decoded view of an engine tile set.
 *
 * Engines hand the renderer `Set<"x,y">`. Decoding that every frame would
 * allocate hundreds of substrings per frame, so we decode into a fixed
 * Int16Array and only redo it when the set identity or size changes —
 * i.e. at most once per tick.
 */
export class TileSetCache {
  readonly xs: Int16Array;
  readonly ys: Int16Array;
  count = 0;
  private lastSet: ReadonlySet<string> | null = null;
  private lastSize = -1;

  constructor(capacity: number) {
    this.xs = new Int16Array(capacity);
    this.ys = new Int16Array(capacity);
  }

  sync(set: ReadonlySet<string> | null): void {
    if (!set) {
      this.count = 0;
      this.lastSet = null;
      this.lastSize = -1;
      return;
    }
    if (set === this.lastSet && set.size === this.lastSize) return;
    this.lastSet = set;
    this.lastSize = set.size;
    let n = 0;
    for (const key of set) {
      if (n >= this.xs.length) break;
      // Manual parse: no slice(), no Number() — nothing to collect.
      let i = 0;
      let x = 0;
      let neg = false;
      if (key.charCodeAt(0) === 45) { neg = true; i = 1; }
      for (; i < key.length; i++) {
        const c = key.charCodeAt(i);
        if (c === 44) { i++; break; }
        x = x * 10 + (c - 48);
      }
      if (neg) x = -x;
      let y = 0;
      neg = false;
      if (key.charCodeAt(i) === 45) { neg = true; i++; }
      for (; i < key.length; i++) y = y * 10 + (key.charCodeAt(i) - 48);
      if (neg) y = -y;
      this.xs[n] = x;
      this.ys[n] = y;
      n++;
    }
    this.count = n;
  }

  /** True when (x, y) is in the decoded set. Linear; prefer `TileMask`
   *  when you need many lookups. */
  has(x: number, y: number): boolean {
    for (let i = 0; i < this.count; i++) if (this.xs[i] === x && this.ys[i] === y) return true;
    return false;
  }

  invalidate(): void {
    this.lastSet = null;
    this.lastSize = -1;
    this.count = 0;
  }
}

/** Membership grid for O(1) lookups during full-arena sweeps. */
export class TileMask {
  private readonly w: number;
  private readonly h: number;
  private stamp = 0;
  private readonly stamps: Int32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.stamps = new Int32Array(w * h);
  }

  reset(): void {
    this.stamp++;
    if (this.stamp === 0x7fffffff) { this.stamps.fill(0); this.stamp = 1; }
  }

  add(x: number, y: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.stamps[y * this.w + x] = this.stamp;
  }

  has(x: number, y: number): boolean {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return false;
    return this.stamps[y * this.w + x] === this.stamp;
  }

  fromCache(cache: TileSetCache): void {
    this.reset();
    for (let i = 0; i < cache.count; i++) this.add(cache.xs[i], cache.ys[i]);
  }
}
