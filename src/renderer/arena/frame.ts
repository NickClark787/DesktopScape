/**
 * The per-frame context handed to every draw routine, and the gradient
 * cache they pull from.
 *
 * Gradients are context-bound and comparatively expensive to build, so
 * each one is created once and invalidated only when the context or the
 * arena scale changes. Packages subclass `GradientCache` to add their own
 * named gradients — as fields, not a keyed map, so nothing allocates a
 * closure or a key string per frame.
 */
import type { QualityProfile } from './options';
import type { Camera } from './projection';

export interface FrameContext {
  cam: Camera;
  q: QualityProfile;
  /** Engine tick + interpolation alpha — a continuous clock in ticks. */
  t: number;
  /** Milliseconds since the renderer started; drives idle oscillation. */
  now: number;
  /** False while the loop is frozen (paused, scrubbing, reduced motion). */
  animating: boolean;
  grad: GradientCache;
  /** One tile half-width in px: the unit every actor is measured in.
   *  Independent of camera yaw — actors must not swell as it turns. */
  u: number;
  /**
   * Vertical foreshortening for upright art, mirrored from `cam.up`.
   * 1 at the default pitch, so every existing height constant still means
   * what it meant; it falls toward 0.44 as the camera pitches over, which
   * is how a standing figure shortens when you look down on it.
   */
  up: number;
  /**
   * Multiplier on the y-radius of anything lying flat on the floor —
   * shadows, rings, glow pools — mirrored from `cam.flat`. Also 1 at the
   * default pitch, rising as the camera looks down and the floor opens up.
   */
  flat: number;
}

export class GradientCache {
  protected ctx: CanvasRenderingContext2D | null = null;
  private scale = -1;
  private w = -1;
  private h = -1;

  ambient: CanvasGradient | null = null;
  vignette: CanvasGradient | null = null;

  /** Rebuild if anything the gradients depend on changed. */
  ensure(ctx: CanvasRenderingContext2D, scale: number, w: number, h: number): void {
    if (this.ctx === ctx && this.scale === scale && this.w === w && this.h === h) return;
    this.ctx = ctx;
    this.scale = scale;
    this.w = w;
    this.h = h;
    this.rebuild(ctx, scale, w, h);
  }

  /** Override to add package-specific gradients; call super first. */
  protected rebuild(ctx: CanvasRenderingContext2D, scale: number, w: number, h: number): void {
    void scale;
    const cx = w / 2;
    const cy = h / 2;
    const amb = ctx.createRadialGradient(cx, cy * 0.85, 0, cx, cy, Math.max(w, h) * 0.62);
    amb.addColorStop(0, 'rgba(255, 214, 140, 0.10)');
    amb.addColorStop(0.55, 'rgba(255, 190, 100, 0.04)');
    amb.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.ambient = amb;

    const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.30, cx, cy, Math.max(w, h) * 0.78);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
    this.vignette = vig;
  }
}
