/**
 * The OSRS-style orbit camera. Presentation layer, and only that.
 *
 * ## Why this file cannot touch the engine
 * In the real client the camera is client-side scenery: it changes what
 * you can see and never what happens. This module mirrors that rule
 * literally. It holds no simulation state, is never read by `advance()`,
 * never feeds the seeded RNG, and is updated from the render loop's
 * delta time rather than from the 0.6 s tick. Orbiting during a fight
 * cannot change a single roll — the fight is byte-for-byte the same run
 * whether you spin the camera or leave it alone.
 *
 * ## Model
 * A pivot (the player's interpolated position) plus `(yaw, pitch,
 * distance)`. The world position is never materialised: the projection is
 * affine, so `yaw`/`pitch` become a 2×2 basis and `distance` becomes a
 * scale multiplier (see `projection.ts`). `distance` is expressed in
 * "fit units" — 1 frames the whole arena, smaller flies in toward the
 * player — which is what makes the OSRS zoom range meaningful on arenas
 * of different sizes.
 *
 * ## Feel
 * Keyboard rotation and the wheel move a *target*; the live value chases
 * it with a framerate-independent exponential ease, which is the slight
 * glide OSRS has. Mouse drag writes both at once, so free-look stays 1:1
 * with the cursor and never feels like it is dragging through syrup.
 *
 * ## Tuning
 * Everything adjustable is in `CAMERA` below — nothing in this file, the
 * input binding or the renderer hard-codes a rotation speed, a limit or a
 * smoothing factor.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Every knob that decides how the camera feels. Angles in degrees,
 * durations in milliseconds, distances in "fit units" (1 = whole arena).
 */
export const CAMERA = {
  // ---- default pose -------------------------------------------------
  /** Matches the classic isometric framing exactly, so an untouched
   *  camera renders precisely the view this trainer always had. */
  DEFAULT_YAW_DEG: 45,
  DEFAULT_PITCH_DEG: 30,
  DEFAULT_DISTANCE: 1,

  // ---- limits -------------------------------------------------------
  /** OSRS clamps pitch to roughly 22.5°–67.5° — never top-down, never
   *  under the floor. Below ~20° the floor plane collapses and the
   *  projection stops being invertible for hit-testing. */
  PITCH_MIN_DEG: 22.5,
  PITCH_MAX_DEG: 67.5,
  /** Yaw is unlimited and wraps at 360°. */

  /** Zoom range. DISTANCE_MAX = 1 is the full-arena view and is the hard
   *  outer stop: there is deliberately nothing beyond it. DISTANCE_MIN is
   *  the close-in-on-the-player end. */
  DISTANCE_MIN: 0.28,
  DISTANCE_MAX: 1,

  // ---- speeds -------------------------------------------------------
  /** Arrow-key rotation, degrees per second. Delta-time scaled, so these
   *  mean the same thing at 30 fps and at 144. */
  KEY_YAW_DEG_PER_SEC: 150,
  KEY_PITCH_DEG_PER_SEC: 95,

  /** Middle-drag free-look, degrees per pixel of cursor movement. */
  DRAG_YAW_DEG_PER_PX: 0.42,
  DRAG_PITCH_DEG_PER_PX: 0.28,

  /** Wheel dolly: fraction of the current distance per notch, so the
   *  step feels the same when close as when far out. */
  WHEEL_STEP: 0.11,
  /** A trackpad emits many small deltas; a mouse emits ±100-ish. */
  WHEEL_PIXELS_PER_NOTCH: 100,

  // ---- smoothing ----------------------------------------------------
  /** Time constant of the ease toward the target, in ms. Larger =
   *  floatier. Mouse drag bypasses both (1:1 by design). */
  ROTATE_SMOOTH_MS: 85,
  ZOOM_SMOOTH_MS: 110,

  /** Below these deltas the camera is considered parked, which is what
   *  lets the render loop shut down again instead of spinning forever. */
  SETTLE_ANGLE_DEG: 0.02,
  SETTLE_DISTANCE: 0.0008,

  /**
   * The static arena layer is baked per pose, quantised to this many
   * degrees so an orbit does not re-bake ~600 path ops every frame.
   *
   * It can be this coarse because the floor is a plane: the live frame
   * blits the baked layer through the exact affine difference between the
   * baked pose and the live one (`blitTransform`), so every tile, grid
   * line and coordinate label lands pixel-exact no matter how stale the
   * bake is. Only the extruded scenery — wall lip, pillars, crowd — is
   * approximated, by at most half a step, and it snaps true the moment
   * the camera stops.
   */
  BAKE_STEP_DEG: 5,
} as const;

/** Wrap to (-π, π] — the shortest way round, for angular easing. */
function wrapPi(a: number): number {
  let v = a % TAU;
  if (v > Math.PI) v -= TAU;
  else if (v <= -Math.PI) v += TAU;
  return v;
}

/** Wrap to [0, 2π). */
function wrapTau(a: number): number {
  const v = a % TAU;
  return v < 0 ? v + TAU : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class OrbitCamera {
  /** Live pose, in radians / fit units. Read by the renderer each frame. */
  yaw = CAMERA.DEFAULT_YAW_DEG * DEG;
  pitch = CAMERA.DEFAULT_PITCH_DEG * DEG;
  distance: number = CAMERA.DEFAULT_DISTANCE;

  /** What the live pose is easing toward. */
  targetYaw = CAMERA.DEFAULT_YAW_DEG * DEG;
  targetPitch = CAMERA.DEFAULT_PITCH_DEG * DEG;
  targetDistance: number = CAMERA.DEFAULT_DISTANCE;

  /**
   * Set the first time the user moves the camera. Once true the renderer
   * stops auto-framing hazards and simply follows the pivot, because the
   * user has said with their hands where they want to be looking.
   */
  manual = false;

  /** True while the live pose has not caught up with the target. */
  moving = false;

  reset(): void {
    this.yaw = this.targetYaw = CAMERA.DEFAULT_YAW_DEG * DEG;
    this.pitch = this.targetPitch = CAMERA.DEFAULT_PITCH_DEG * DEG;
    this.distance = this.targetDistance = CAMERA.DEFAULT_DISTANCE;
    this.manual = false;
    this.moving = false;
  }

  /** Ease toward the default pose rather than snapping to it. */
  recentre(): void {
    this.targetYaw = CAMERA.DEFAULT_YAW_DEG * DEG;
    this.targetPitch = CAMERA.DEFAULT_PITCH_DEG * DEG;
    this.targetDistance = CAMERA.DEFAULT_DISTANCE;
    this.manual = false;
    this.moving = true;
  }

  // -------------------------------------------------------- keyboard

  /** Arrow keys: move the target, let the live pose glide after it. */
  rotateBy(yawDeg: number, pitchDeg: number): void {
    if (yawDeg === 0 && pitchDeg === 0) return;
    this.targetYaw = wrapTau(this.targetYaw + yawDeg * DEG);
    this.targetPitch = clampPitch(this.targetPitch + pitchDeg * DEG);
    this.manual = true;
    this.moving = true;
  }

  // ------------------------------------------------------ mouse drag

  /** Middle-drag free-look: 1:1 with the cursor, no easing. */
  dragBy(dxPx: number, dyPx: number): void {
    if (dxPx === 0 && dyPx === 0) return;
    this.targetYaw = wrapTau(this.targetYaw + dxPx * CAMERA.DRAG_YAW_DEG_PER_PX * DEG);
    this.targetPitch = clampPitch(this.targetPitch + dyPx * CAMERA.DRAG_PITCH_DEG_PER_PX * DEG);
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.manual = true;
  }

  // ----------------------------------------------------------- wheel

  /**
   * Dolly toward or away from the pivot. `notches` > 0 zooms in. The step
   * is multiplicative so it feels even across the whole range, and the
   * result is hard-clamped: there is no view further out than the whole
   * arena and none closer than DISTANCE_MIN.
   */
  zoomBy(notches: number): void {
    if (notches === 0) return;
    const factor = Math.pow(1 - CAMERA.WHEEL_STEP, notches);
    this.targetDistance = clamp(
      this.targetDistance * factor, CAMERA.DISTANCE_MIN, CAMERA.DISTANCE_MAX,
    );
    this.manual = true;
    this.moving = true;
  }

  // ---------------------------------------------------------- update

  /**
   * Advance the ease by `dtMs` of *wall* time — never by ticks. Returns
   * true while the camera is still in motion, which is what keeps the
   * render loop awake for a camera move made while the fight is paused.
   */
  update(dtMs: number): boolean {
    const dt = dtMs > 250 ? 250 : dtMs; // a stall must not teleport the view
    const kr = 1 - Math.exp(-dt / CAMERA.ROTATE_SMOOTH_MS);
    const kz = 1 - Math.exp(-dt / CAMERA.ZOOM_SMOOTH_MS);

    const dYaw = wrapPi(this.targetYaw - this.yaw);
    const dPitch = this.targetPitch - this.pitch;
    const dDist = this.targetDistance - this.distance;

    const settleA = CAMERA.SETTLE_ANGLE_DEG * DEG;
    if (Math.abs(dYaw) <= settleA) this.yaw = this.targetYaw;
    else this.yaw = wrapTau(this.yaw + dYaw * kr);

    if (Math.abs(dPitch) <= settleA) this.pitch = this.targetPitch;
    else this.pitch += dPitch * kr;

    if (Math.abs(dDist) <= CAMERA.SETTLE_DISTANCE) this.distance = this.targetDistance;
    else this.distance += dDist * kz;

    this.moving = this.yaw !== this.targetYaw
      || this.pitch !== this.targetPitch
      || this.distance !== this.targetDistance;
    return this.moving;
  }

  /** Zoom expressed the way `fitCamera` wants it: a scale multiplier. */
  get zoomMultiplier(): number {
    return 1 / Math.max(1e-3, this.distance);
  }

  /** Pose rounded to the bake quantum, for the static layer's cache key. */
  bakeYawDeg(): number {
    return quantise(this.yaw / DEG, CAMERA.BAKE_STEP_DEG);
  }

  bakePitchDeg(): number {
    return quantise(this.pitch / DEG, CAMERA.BAKE_STEP_DEG);
  }
}

function clampPitch(rad: number): number {
  return clamp(rad, CAMERA.PITCH_MIN_DEG * DEG, CAMERA.PITCH_MAX_DEG * DEG);
}

function quantise(v: number, step: number): number {
  return Math.round(v / step) * step;
}
