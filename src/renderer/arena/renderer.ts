/**
 * `ArenaRenderer` — the engine-agnostic half of a fight renderer: the
 * canvas, the single render loop, tick-to-frame interpolation, effect
 * pools, camera framing, the perf budget and auto-downgrade.
 *
 * A fight package subclasses this and supplies only what is specific to
 * its engine: how to read a tick and the player's tile out of a snapshot,
 * what must stay framed, what to do with new events, and how to draw the
 * scene. Everything else — and every performance rule — lives here once.
 *
 * ## Tick / frame separation
 * The engine steps in whole 0.6 s ticks; the renderer draws at up to
 * `fpsCap` frames per second and interpolates between the last two engine
 * states. Each frame:
 *
 *   1. `host.step(dtMs)` — the sim owner accumulates scaled wall time and
 *      calls `advance()` zero or more times. Fixed timestep: engine logic
 *      is NEVER advanced once per frame, and frame rate cannot change
 *      fight outcomes.
 *   2. `host.alpha()` — 0..1 progress into the current tick.
 *   3. If the tick changed, capture the new state, keep the previous one,
 *      and drain new engine events into effect pools.
 *   4. Draw `prev → cur` blended by alpha.
 *
 * ## Stopping
 * The loop runs only while the sim is running AND the canvas is visible.
 * Pausing, finishing, hiding the tab or scrolling the canvas out of view
 * all `cancelAnimationFrame`. There is no idle repaint. State changes
 * while stopped (scrubbing, tick-step, toggling an option) call
 * `requestStill()`, which draws exactly one frame.
 *
 * ## Allocation
 * Everything is pre-allocated: pools, gradients, scratch points, the
 * baked layers subclasses hold. The draw path allocates nothing; effect
 * payload strings are built at spawn time, on a tick, never per frame.
 */
import { OrbitCamera } from './camera';
import { CameraInput } from './cameraInput';
import { FxPool, ParticleField } from './effects';
import { GradientCache, type FrameContext } from './frame';
import { drawAssistChip, drawBanner, drawLatencyBadge, drawPerfHud, drawTickBar, type PerfStats } from './hud';
import {
  QUALITY, lowerTier, type GraphicsOptions, type QualityProfile, type QualityTier,
} from './options';
import {
  blitTransform, clamp, fitCamera, makeCamera, makeMat, projectTile, screenToTile, tileUnit,
  type Camera, type Mat, type Point,
} from './projection';
import { FONT_LABEL, HUD } from './hud';
import { outlinedText } from './shapes';

/** What the renderer needs from whoever owns the simulation. */
export interface SimHost<S> {
  /** Current engine snapshot, or null when no run exists. */
  getSnapshot(): S | null;
  /** The engine's append-only event log. */
  getEvents(): readonly unknown[];
  /**
   * Advance the sim by `dtMs` of wall time (the host applies the speed
   * multiplier and the fixed-timestep accumulator). Called once per frame
   * while running; never called while paused.
   */
  step(dtMs: number): void;
  /** Progress into the current tick, 0..1. */
  alpha(): number;
  /** Identity of the current sim instance — changes on restart/scrub. */
  runId(): number;
}

export interface RendererCallbacks {
  onQualityChange(q: QualityTier, automatic: boolean): void;
  onPerf?(stats: PerfStats): void;
}

export interface RectAB { a0: number; b0: number; a1: number; b1: number }

interface CapturedState {
  tick: number;
  playerX: number;
  playerY: number;
}

const SUSTAINED_MS = 2000;

export abstract class ArenaRenderer<S> {
  protected canvas: HTMLCanvasElement;
  protected ctx: CanvasRenderingContext2D;
  protected host: SimHost<S>;
  private cbs: RendererCallbacks;

  protected opts: GraphicsOptions;
  protected pingMs = 0;
  protected reducedMotion = false;

  // Loop state.
  private raf = 0;
  private running = false;
  private visible = true;
  private lastFrame = 0;
  private lastDraw = 0;
  private startedAt = 0;

  // Interpolation.
  private prev: CapturedState = { tick: -1, playerX: 0, playerY: 0 };
  private cur: CapturedState = { tick: -1, playerX: 0, playerY: 0 };
  protected eventCursor = 0;
  private lastRunId = -1;
  /**
   * The tick alpha the last drawn frame used. Still frames — a pause, a
   * scrub, or a camera move made while the fight is stopped — redraw at
   * this instead of snapping back to 0, so orbiting a paused fight does
   * not teleport the player back to the previous tile.
   */
  private heldAlpha = 0;

  // Camera. Purely presentational: see `camera.ts`.
  protected readonly orbit = new OrbitCamera();
  private readonly camInput: CameraInput | null;

  // Pre-allocated resources.
  protected cam: Camera;
  private readonly blitMat: Mat = makeMat();
  protected grad: GradientCache;
  protected fx = new FxPool();
  protected particles = new ParticleField();
  protected frame: FrameContext;

  // Perf tracking.
  private frameTimes = new Float32Array(90);
  private frameIdx = 0;
  private frameEma = 16;
  private dropped = 0;
  private overBudgetSince = -1;
  private autoDowngraded = false;
  private perf: PerfStats = {
    fps: 0, frameMs: 0, worstMs: 0, dropped: 0, quality: 'high',
    effects: 0, particles: 0, autoDowngraded: false,
  };

  private observer: IntersectionObserver | null = null;
  private sizeObserver: ResizeObserver | null = null;
  /** CSS box, cached. Reading getBoundingClientRect() every frame forces
   *  layout — exactly the thing the perf rules forbid. */
  private cssW = 640;
  private cssH = 420;
  private readonly onVisibility = () => this.syncLoop();

  constructor(
    canvas: HTMLCanvasElement,
    host: SimHost<S>,
    opts: GraphicsOptions,
    cbs: RendererCallbacks,
    gridW: number,
    gridH: number,
    grad: GradientCache = new GradientCache(),
  ) {
    this.canvas = canvas;
    this.host = host;
    this.opts = opts;
    this.cbs = cbs;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.startedAt = performance.now();
    this.cam = makeCamera(gridW, gridH);
    this.grad = grad;
    this.frame = {
      cam: this.cam, q: QUALITY.high, t: 0, now: 0, animating: true,
      grad: this.grad, u: 24, up: 1, flat: 1,
    };

    if (typeof window !== 'undefined' && window.matchMedia) {
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        this.syncLoop();
      }, { threshold: 0.01 });
      this.observer.observe(canvas);
    }
    const rect = canvas.getBoundingClientRect();
    this.cssW = Math.max(120, Math.round(rect.width || 640));
    this.cssH = Math.max(120, Math.round(rect.height || 420));
    if (typeof ResizeObserver !== 'undefined') {
      this.sizeObserver = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (!box) return;
        this.cssW = Math.max(120, Math.round(box.width));
        this.cssH = Math.max(120, Math.round(box.height));
        this.requestStill();
      });
      this.sizeObserver.observe(canvas);
    }

    this.camInput = typeof window === 'undefined' ? null : new CameraInput(
      canvas,
      this.orbit,
      () => this.onCameraInput(),
      () => this.visible && !document.hidden,
    );
  }

  /** Camera input arrived. Wake the loop if it is parked — the camera
   *  must move while the fight is paused, without advancing the fight. */
  private onCameraInput(): void {
    this.syncLoop();
    if (!this.raf) this.requestStill();
  }

  // ------------------------------------------------------- subclass hooks

  protected abstract tickOf(s: S): number;
  protected abstract playerTileOf(s: S, out: Point): Point;
  protected abstract isFinished(s: S): boolean;
  /** Engine assists currently enabled — drives the honesty chip. */
  protected abstract assistCount(): number;
  protected abstract pendingInputCount(s: S): number;
  /** Grid-space rect that must stay framed. Write into `out`. */
  protected abstract requiredRect(s: S, px: number, py: number, out: RectAB): void;
  /** New engine events arrived; spawn effects. Runs once per tick. */
  protected abstract onTickAdvanced(s: S): void;
  /** Draw the arena: layers, terrain, actors, effects, per-fight HUD. */
  protected abstract drawScene(
    ctx: CanvasRenderingContext2D, s: S, w: number, h: number, px: number, py: number,
  ): void;
  /** Outcome banner, or null while the fight is live. */
  protected abstract outcomeBanner(s: S): { text: string; tint: string } | null;

  /** Nudge the camera after fitting — e.g. to keep a tall boss on screen.
   *  Default: leave the tile framing as computed. */
  protected keepVisible(s: S, w: number, h: number): void { void s; void w; void h; }

  /** Backdrop behind the arena. */
  protected backgroundColor(): string { return '#100d09'; }

  /** Message shown when there is no run yet. */
  protected idleMessage(): string { return 'Press Start fight'; }

  // ------------------------------------------------------------- settings

  setOptions(opts: GraphicsOptions): void {
    const qualityChanged = opts.quality !== this.opts.quality;
    this.opts = opts;
    if (qualityChanged) {
      this.autoDowngraded = false;
      this.overBudgetSince = -1;
    }
    this.requestStill();
  }

  setPing(ms: number): void { this.pingMs = ms; }

  setRunning(running: boolean): void {
    if (this.running === running) return;
    this.running = running;
    this.lastFrame = performance.now();
    this.syncLoop();
    if (!running) this.requestStill();
  }

  protected get isRunning(): boolean { return this.running; }

  /** Reset interpolation and effects — restart, import, scrub. */
  resetForNewRun(): void {
    this.prev.tick = -1;
    this.cur.tick = -1;
    this.heldAlpha = 0;
    this.eventCursor = 0;
    this.fx.clear();
    this.particles.clear();
    this.onReset();
  }

  /** Subclasses drop their own cached decode state here. */
  protected onReset(): void { /* nothing by default */ }

  /** Ease the camera back to the default framing. */
  recentreCamera(): void {
    this.orbit.recentre();
    this.onCameraInput();
  }

  destroy(): void {
    this.stop();
    this.camInput?.destroy();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.observer?.disconnect();
    this.observer = null;
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    this.onDestroy();
  }

  /** Subclasses release baked layers here — a stale multi-MB backing store
   *  is the kind of thing that quietly accumulates across tab switches. */
  protected onDestroy(): void { /* nothing by default */ }

  // ----------------------------------------------------------------- loop

  /** The camera still needs frames after the fight has stopped: an orbit
   *  or a zoom glide has to animate while paused. */
  private get cameraBusy(): boolean {
    return this.orbit.moving || (this.camInput?.active ?? false);
  }

  private syncLoop(): void {
    const wanted = this.running || this.cameraBusy;
    const shouldRun = wanted && this.visible && !document.hidden;
    if (shouldRun && !this.raf) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.tickFrame);
    } else if (!shouldRun && this.raf) {
      this.stop();
      this.requestStill();
    }
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Draw exactly one frame without starting the loop. Used for paused
   *  state changes: scrubbing, tick-step, toggling a setting. */
  requestStill(): void {
    if (this.raf) return; // the live loop will pick it up
    const now = performance.now();
    this.captureIfTickChanged();
    this.orbit.update(0);
    this.draw(now, this.heldAlpha, false);
  }

  private readonly tickFrame = (now: number): void => {
    this.raf = requestAnimationFrame(this.tickFrame);

    let dt = now - this.lastFrame;
    this.lastFrame = now;
    if (dt > 250) dt = 250; // a long stall must not fast-forward the fight

    // The camera runs on wall time at render rate, never on the tick —
    // and a camera-only frame must not touch the sim. `step` is the one
    // call that advances the fight, and it is gated on `running` alone.
    const live = this.running;
    if (live) {
      this.host.step(dt);
      this.captureIfTickChanged();
    }
    this.camInput?.applyHeldKeys(dt);
    this.orbit.update(dt);

    // Frame cap — the sim still advances, we just draw less often.
    const interval = 1000 / Math.max(15, this.opts.fpsCap);
    if (now - this.lastDraw < interval - 0.6) return;
    const frameDt = this.lastDraw > 0 ? now - this.lastDraw : interval;
    this.lastDraw = now;

    const t0 = performance.now();
    if (live) {
      this.fx.update(frameDt);
      if (this.quality().maxParticles > 0) this.particles.update(frameDt);
      this.heldAlpha = this.host.alpha();
    }
    this.draw(now, this.heldAlpha, live);
    this.recordFrame(performance.now() - t0, frameDt, interval);

    // Nothing left to animate: park the loop again rather than burn a
    // frame budget on a static picture.
    if (!live && !this.cameraBusy) this.stop();
  };

  protected quality(): QualityProfile {
    return QUALITY[this.opts.quality];
  }

  // -------------------------------------------------------- state capture

  private captureIfTickChanged(): void {
    const s = this.host.getSnapshot();
    if (!s) return;
    const runId = this.host.runId();
    if (runId !== this.lastRunId) {
      this.lastRunId = runId;
      this.resetForNewRun();
    }
    const tick = this.tickOf(s);
    if (tick === this.cur.tick) return;

    // A jump of anything but +1 (restart, scrub, tick skip) must snap, not
    // tween — interpolating across a scrub would show motion that never
    // happened.
    const contiguous = tick === this.cur.tick + 1 && this.cur.tick >= 0;
    this.playerTileOf(s, CAP);
    if (contiguous) {
      this.prev.tick = this.cur.tick;
      this.prev.playerX = this.cur.playerX;
      this.prev.playerY = this.cur.playerY;
    } else {
      this.prev.tick = tick;
      this.prev.playerX = CAP.x;
      this.prev.playerY = CAP.y;
      this.eventCursor = this.host.getEvents().length;
      this.fx.clear();
      this.particles.clear();
      this.onReset();
    }
    this.cur.tick = tick;
    this.cur.playerX = CAP.x;
    this.cur.playerY = CAP.y;
    // A tick captured while stopped is a tick-step or a scrub: show the
    // engine's committed position, not a half-finished tween of it.
    if (!this.running) this.heldAlpha = 1;

    if (contiguous) this.onTickAdvanced(s);
  }

  /** Previous-tick player tile — subclasses use it to derive facing. */
  protected get prevPlayer(): CapturedState { return this.prev; }
  protected get curPlayer(): CapturedState { return this.cur; }

  // ----------------------------------------------------------------- draw

  /**
   * Resize the backing store to the cached CSS box at the tier's DPR.
   * DPR is capped per tier because fill rate — not geometry — is what
   * costs on a weak GPU: a 1.5× backing store is 2.25× the pixels.
   */
  protected syncCanvasSize(): { w: number; h: number; dpr: number } {
    const q = this.quality();
    const cssW = this.cssW;
    const cssH = this.cssH;
    const dpr = Math.min(q.maxDpr, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: cssW, h: cssH, dpr };
  }

  /** Device-pixel ratio of the last sized frame — for baked layers. */
  protected lastDpr = 1;

  private draw(now: number, alpha: number, animating: boolean): void {
    const s = this.host.getSnapshot();
    const ctx = this.ctx;
    const { w, h, dpr } = this.syncCanvasSize();
    this.lastDpr = dpr;

    ctx.fillStyle = this.backgroundColor();
    ctx.fillRect(0, 0, w, h);
    if (!s) {
      outlinedText(ctx, this.idleMessage(), w / 2, h / 2, HUD.dim, FONT_LABEL);
      return;
    }

    const q = this.quality();
    // Interpolation is not gated on `animating`: a still frame redraws at
    // the alpha the loop stopped on, so panning the camera around a
    // paused fight holds the player exactly where they were.
    const interp = q.interpolate && !this.reducedMotion;
    const a = interp ? clamp(alpha, 0, 1) : 0;

    // Interpolated player position: a straight lerp between two committed
    // engine states, never an extrapolation. At alpha = 1 the drawn tile
    // is exactly the engine's.
    const hasPrev = this.prev.tick >= 0 && this.cur.tick === this.prev.tick + 1;
    const px = hasPrev ? this.prev.playerX + (this.cur.playerX - this.prev.playerX) * a : this.cur.playerX;
    const py = hasPrev ? this.prev.playerY + (this.cur.playerY - this.prev.playerY) * a : this.cur.playerY;

    this.updateCamera(s, w, h, px, py);
    this.frame.cam = this.cam;
    this.frame.q = q;
    this.frame.t = this.tickOf(s) + a;
    this.frame.now = now - this.startedAt;
    this.frame.animating = animating && !this.reducedMotion;
    this.frame.u = tileUnit(this.cam);
    this.frame.up = this.cam.up;
    this.frame.flat = this.cam.flat;
    this.grad.ensure(ctx, this.cam.scale, w, h);

    this.drawScene(ctx, s, w, h, px, py);

    // Shared HUD.
    if (this.opts.showTickBar) drawTickBar(ctx, w, h, this.tickOf(s), a, this.running);
    if (this.opts.showLatencyIndicator) drawLatencyBadge(ctx, h, this.pingMs, this.pendingInputCount(s));
    drawAssistChip(ctx, this.assistCount());
    if (this.isFinished(s)) {
      const banner = this.outcomeBanner(s);
      if (banner) drawBanner(ctx, w, h, banner.text, banner.tint);
    }
    if (this.opts.showPerfHud) {
      this.perf.effects = this.fx.liveCount;
      this.perf.particles = this.particles.liveCount;
      drawPerfHud(ctx, w, this.perf, now);
    }
  }

  /**
   * Recompute the framing for this frame. The orbit pose is applied here
   * and nowhere else, so there is exactly one place where camera state
   * turns into pixels.
   *
   * Two rules change once the user takes manual control:
   *  - the must-see clamp is released. Flying in close is a deliberate
   *    choice, and refusing to honour the wheel because a hazard might
   *    leave the frame would make the control feel broken. Until then the
   *    auto-framing behaves exactly as it always has.
   *  - the pivot is the player, follow-toggle or not. An orbit camera
   *    that does not track its pivot is not an orbit camera.
   */
  private updateCamera(s: S, w: number, h: number, px: number, py: number): void {
    const manual = this.orbit.manual && this.opts.view !== 'tactical';
    let required: RectAB | null = null;
    if (!manual) {
      this.requiredRect(s, px, py, REQ);
      required = REQ;
    }
    FOCUS.x = px + 0.5;
    FOCUS.y = this.cam.gh - 1 - py + 0.5;
    fitCamera(this.cam, {
      canvasW: w,
      canvasH: h,
      mode: this.opts.view,
      zoom: this.opts.zoom * this.orbit.zoomMultiplier,
      focus: manual || this.opts.followPlayer ? FOCUS : null,
      required,
      yaw: this.orbit.yaw,
      pitch: this.orbit.pitch,
    });
    this.keepVisible(s, w, h);
  }

  /**
   * Blit a baked world-space layer so it lines up with the live camera.
   *
   * The layer carries the camera it was baked with; the difference
   * between that and the live one is an affine transform, so a layer
   * baked at one orbit angle re-projects exactly onto another without a
   * re-bake. See `blitTransform`.
   */
  protected blitStaticLayer(
    ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, bakedWith: Camera,
  ): void {
    const dpr = this.lastDpr;
    const m = blitTransform(bakedWith, this.cam, this.blitMat);
    // The common case — camera parked, bake current — must stay the plain
    // integer-offset blit it always was, with no resampling of the floor.
    // The matrix is built by division, so compare with a tolerance.
    if (Math.abs(m.a - 1) < 1e-9 && Math.abs(m.d - 1) < 1e-9
      && Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9) {
      ctx.drawImage(canvas, m.e, m.f, canvas.width / dpr, canvas.height / dpr);
      return;
    }
    ctx.save();
    ctx.setTransform(
      dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f,
    );
    ctx.drawImage(canvas, 0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.restore();
  }

  /**
   * Shift the camera down until `tileX,tileY` has `headroomPx` of clear
   * space above it, without pushing the player past the bottom edge.
   * Tile framing alone is not enough when an actor's art stands well above
   * its tiles.
   */
  protected nudgeForHeadroom(
    tileX: number, tileY: number, headroomPx: number,
    playerX: number, playerY: number, h: number,
  ): void {
    projectTile(this.cam, tileX, tileY, PT);
    const top = PT.y - headroomPx;
    if (top >= TOP_MARGIN) return;
    projectTile(this.cam, playerX, playerY, PT);
    const room = h - BOTTOM_MARGIN - PT.y;
    this.cam.oy += Math.min(TOP_MARGIN - top, Math.max(0, room));
  }

  // ----------------------------------------------------------------- perf

  private recordFrame(costMs: number, frameDt: number, interval: number): void {
    this.frameTimes[this.frameIdx] = costMs;
    this.frameIdx = (this.frameIdx + 1) % this.frameTimes.length;
    this.frameEma = this.frameEma * 0.9 + costMs * 0.1;
    if (frameDt > interval * 1.75) this.dropped++;

    let worst = 0;
    for (let i = 0; i < this.frameTimes.length; i++) {
      if (this.frameTimes[i] > worst) worst = this.frameTimes[i];
    }
    this.perf.fps = frameDt > 0 ? 1000 / frameDt : 0;
    this.perf.frameMs = this.frameEma;
    this.perf.worstMs = worst;
    this.perf.dropped = this.dropped;
    this.perf.quality = this.opts.quality;
    this.perf.autoDowngraded = this.autoDowngraded;
    this.cbs.onPerf?.(this.perf);

    this.maybeDowngrade(interval);
  }

  /**
   * Auto-downgrade: if the smoothed draw cost sits above the frame budget
   * for a sustained window, drop one tier. One-way on purpose — auto
   * upgrading would oscillate the moment the cheaper tier fits.
   */
  private maybeDowngrade(interval: number): void {
    if (!this.opts.autoQuality) return;
    const budget = interval * 0.8;
    const now = performance.now();
    if (this.frameEma <= budget) {
      this.overBudgetSince = -1;
      return;
    }
    if (this.overBudgetSince < 0) {
      this.overBudgetSince = now;
      return;
    }
    if (now - this.overBudgetSince < SUSTAINED_MS) return;
    const next = lowerTier(this.opts.quality);
    this.overBudgetSince = -1;
    if (!next) return;
    this.autoDowngraded = true;
    this.opts = { ...this.opts, quality: next };
    this.frameEma = interval * 0.5; // give the new tier a clean slate
    this.cbs.onQualityChange(next, true);
  }

  // ------------------------------------------------------------ hit-test

  /** Client pixel → tile, or null when outside the arena. */
  hitTest(clientX: number, clientY: number): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    return screenToTile(this.cam, clientX - rect.left, clientY - rect.top, PT);
  }
}

const PT: Point = { x: 0, y: 0 };
const CAP: Point = { x: 0, y: 0 };
const REQ: RectAB = { a0: 0, b0: 0, a1: 0, b1: 0 };
const FOCUS: Point = { x: 0, y: 0 };
const TOP_MARGIN = 34;
const BOTTOM_MARGIN = 56;

/** Deterministic scatter in [-0.5, 0.5] — replay-stable, allocation-free. */
export function jitter(i: number): number {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return (v - Math.floor(v)) - 0.5;
}
