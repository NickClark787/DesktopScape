/**
 * Transient visual effects: hitsplats, swing arcs, shockwave rings,
 * bursts, floating text — and a particle field for embers and dust.
 *
 * Everything is pre-allocated. `spawn()` never calls `new`; it hands back
 * a slot from a fixed array, recycling the oldest live one when the pool
 * is full. Effect payloads are a flat struct with a `kind` tag rather than
 * a class hierarchy, so the pool stays monomorphic and there is nothing to
 * garbage-collect mid-fight.
 *
 * No DOM here — unit-tested under vitest's node environment.
 */
import { POOL_CAP_EFFECTS, POOL_CAP_PARTICLES } from './options';

export const enum FxKind {
  Hitsplat = 0,
  Swing = 1,
  Ring = 2,
  Burst = 3,
  Text = 4,
  Slam = 5,
  Beam = 6,
}

/** Palette slots effects reference by index — see `palette.ts`. */
export const enum FxColor {
  Damage = 0,
  Miss = 1,
  Typeless = 2,
  Prayer = 3,
  Heal = 4,
  Spec = 5,
  Gold = 6,
  Danger = 7,
  Safe = 8,
}

export interface Fx {
  active: boolean;
  kind: FxKind;
  /** Tile-space anchor, fractional — effects can sit between tiles. */
  a: number;
  b: number;
  /** Screen-space direction, unit-ish; used by swings and slams. */
  dx: number;
  dy: number;
  /** Milliseconds elapsed / total lifetime. */
  age: number;
  life: number;
  /** Pose used when the loop is frozen (paused, tick-step, scrubbing), so
   *  a stepped tick still shows its feedback instead of a blank frame. */
  peak: number;
  /** Numeric payload — damage, radius in tiles, etc. */
  value: number;
  /** Secondary payload — e.g. ring end radius, text variant. */
  value2: number;
  color: FxColor;
  /**
   * Label drawn with the effect. Assigned at SPAWN time (i.e. on a tick
   * event), never in the draw loop — `String(damage)` allocates, and the
   * draw loop must not.
   */
  text: string;
  /** Spawn order; lets the pool evict the oldest deterministically. */
  serial: number;
}

function blankFx(): Fx {
  return {
    active: false, kind: FxKind.Hitsplat, a: 0, b: 0, dx: 0, dy: 0,
    age: 0, life: 1, peak: 0.35, value: 0, value2: 0,
    color: FxColor.Damage, text: '', serial: 0,
  };
}

export class FxPool {
  readonly items: Fx[];
  private serial = 0;

  constructor(capacity: number = POOL_CAP_EFFECTS) {
    this.items = new Array<Fx>(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = blankFx();
  }

  /**
   * Claim a slot. `limit` caps how much of the pool the current quality
   * tier is allowed to use, so dropping a tier costs nothing to apply.
   * Returns a reset Fx ready to be filled in — never null, never `new`.
   */
  spawn(limit: number = this.items.length): Fx {
    const cap = Math.max(1, Math.min(limit, this.items.length));
    let oldest = 0;
    let oldestSerial = Infinity;
    for (let i = 0; i < cap; i++) {
      const fx = this.items[i];
      if (!fx.active) { oldest = i; oldestSerial = -1; break; }
      if (fx.serial < oldestSerial) { oldestSerial = fx.serial; oldest = i; }
    }
    const fx = this.items[oldest];
    fx.active = true;
    fx.age = 0;
    fx.life = 1;
    fx.peak = 0.35;
    fx.dx = 0; fx.dy = 0;
    fx.value = 0; fx.value2 = 0;
    fx.text = '';
    fx.serial = ++this.serial;
    // Deactivate anything parked beyond the current tier's cap so a
    // downgrade does not leave stale effects drawn forever.
    for (let i = cap; i < this.items.length; i++) this.items[i].active = false;
    return fx;
  }

  update(dtMs: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const fx = this.items[i];
      if (!fx.active) continue;
      fx.age += dtMs;
      if (fx.age >= fx.life) fx.active = false;
    }
  }

  clear(): void {
    for (let i = 0; i < this.items.length; i++) this.items[i].active = false;
  }

  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].active) n++;
    return n;
  }
}

/**
 * Particle field for dust, embers and sparks. Struct-of-arrays in typed
 * arrays: one allocation at construction, zero per frame, and the update
 * loop stays cache-friendly even at the high-tier cap.
 */
export class ParticleField {
  readonly capacity: number;
  /** Tile-space position; velocities are tiles/second. */
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly va: Float32Array;
  readonly vb: Float32Array;
  /** Screen-space vertical offset and its velocity (particles rise). */
  readonly z: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly color: Uint8Array;
  readonly size: Float32Array;
  private cursor = 0;
  count = 0;

  constructor(capacity: number = POOL_CAP_PARTICLES) {
    this.capacity = Math.max(1, capacity);
    const n = this.capacity;
    this.a = new Float32Array(n);
    this.b = new Float32Array(n);
    this.va = new Float32Array(n);
    this.vb = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.color = new Uint8Array(n);
    this.size = new Float32Array(n);
  }

  /** Emit one particle, overwriting the oldest slot when saturated. */
  emit(
    a: number, b: number, va: number, vb: number, vz: number,
    lifeMs: number, color: FxColor, size: number, limit: number,
  ): void {
    const cap = Math.min(limit, this.capacity);
    if (cap <= 0) return;
    const i = this.cursor % cap;
    this.cursor = (this.cursor + 1) % cap;
    this.a[i] = a; this.b[i] = b;
    this.va[i] = va; this.vb[i] = vb;
    this.z[i] = 0; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = lifeMs;
    this.color[i] = color; this.size[i] = size;
    if (i >= this.count) this.count = i + 1;
  }

  update(dtMs: number): void {
    const s = dtMs / 1000;
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dtMs;
      this.a[i] += this.va[i] * s;
      this.b[i] += this.vb[i] * s;
      this.z[i] += this.vz[i] * s;
      this.vz[i] -= 40 * s; // gravity, in screen px/s²
    }
  }

  clear(): void {
    this.age.fill(0);
    this.life.fill(0);
    this.count = 0;
    this.cursor = 0;
  }

  isAlive(i: number): boolean { return this.age[i] < this.life[i]; }

  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.isAlive(i)) n++;
    return n;
  }
}

/** 0..1 progress, or the frozen `peak` pose when the loop is not running. */
export function fxProgress(fx: Fx, animating: boolean): number {
  if (!animating) return fx.peak;
  return fx.life > 0 ? Math.min(1, fx.age / fx.life) : 1;
}

export function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}
