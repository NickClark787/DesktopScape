/**
 * Tile ⇄ screen projection and the camera that frames an arena.
 *
 * Engine-agnostic: the grid size lives on the `Camera`, so the same maths
 * serves the Colosseum's 16×15 box and the Inferno's 25×18 platform.
 *
 * Pure — no DOM — and unit-tested, because a projection that is off by
 * half a tile makes every footwork lesson a lie.
 *
 * Nothing here touches the simulation. The camera is a *view* concept in
 * exactly the way it is in the real client: it changes where pixels land
 * and nothing else. No function in this file is ever called from `advance()`.
 *
 * ## Grid space
 * Engine tile space has x growing east and y growing NORTH. Screen space
 * grows down. We convert once, into "grid space" (a, b):
 *
 *     a = x + 0.5                  (east,  continuous, tile centre at +0.5)
 *     b = (gh - 1 - y) + 0.5       (south, continuous)
 *
 * so a tile's corners are (a ± 0.5, b ± 0.5) and the arena occupies
 * a ∈ [0, gw], b ∈ [0, gh].
 *
 * ## Orbit mode (the isometric view, generalised)
 * The floor is a plane, so a camera orbiting it at (yaw, pitch) projects
 * grid space through a plain 2×2 basis — a yaw rotation in the floor
 * plane, then a vertical squash by sin(pitch):
 *
 *     sx = a·m11 + b·m21 + ox        m11 =  R·s·cos(yaw)
 *     sy = a·m12 + b·m22 + oy        m21 = -R·s·sin(yaw)
 *                                    m12 =  R·s·sin(yaw)·sin(pitch)
 *                                    m22 =  R·s·cos(yaw)·sin(pitch)
 *
 * with R = ISO_HW·√2. At the defaults — yaw 45°, pitch 30° — this reduces
 * *exactly* to the classic 2:1 diamond:
 *
 *     sx = (a - b)·HW·scale         sy = (a + b)·HH·scale
 *
 * so the untouched camera renders the arena it always did, and rotating
 * it is a continuous move away from that pose. North reads up-screen at
 * the default yaw: a boss against the north wall sits at the top of the
 * diamond with the player below.
 *
 * Because the map is affine, three useful things hold and are relied on
 * elsewhere: a baked world-space layer only ever needs re-blitting at a
 * new offset when the camera *pans*; the arena's screen bounding box is a
 * separable sum over the two axes; and a circle on the floor projects to
 * an axis-aligned ellipse whose height ratio is sin(pitch) regardless of
 * yaw.
 *
 * ## Tactical mode
 * A plain square grid, same tile addressing, no depth and no orbit. The
 * cheapest thing to draw and the least ambiguous for pure footwork
 * drilling, so it is deliberately left axis-aligned.
 */
import type { ViewMode } from './options';

/** Half-width / half-height of one iso tile diamond at scale 1. */
export const ISO_HW = 24;
export const ISO_HH = 12;
/** Square tile size in tactical mode at scale 1. */
export const TAC_TILE = 28;

/** Grid unit → screen px at scale 1, before pitch foreshortening. */
export const ORBIT_R = ISO_HW * Math.SQRT2;

/** The pose the classic 2:1 isometric view *is*. Also the camera default. */
export const ISO_YAW = Math.PI / 4;
export const ISO_PITCH = Math.asin(ISO_HH / ISO_HW); // exactly 30°

/** Baselines the `up` / `flat` multipliers are measured against, so both
 *  read 1 at the default pose and every existing art constant still means
 *  what it meant. */
const ISO_UP = Math.cos(ISO_PITCH);
const ISO_FLAT = Math.sin(ISO_PITCH);

/** Room reserved outside the floor for scenery (columns, crowds, walls). */
export const WORLD_PAD_TOP = 132;
export const WORLD_PAD_BOTTOM = 46;
export const WORLD_PAD_SIDE = 46;

export interface Point { x: number; y: number }

export interface Camera {
  mode: ViewMode;
  /** Multiplier applied to ISO_HW/HH or TAC_TILE. */
  scale: number;
  /** Screen-space translation applied after projection. */
  ox: number;
  oy: number;
  /** Arena size in tiles. */
  gw: number;
  gh: number;

  /** Orbit yaw in radians. Ignored in tactical mode. */
  yaw: number;
  /** Orbit pitch in radians, measured up from the floor plane. */
  pitch: number;

  // ---- derived by `syncBasis`; never assign these by hand ----
  /** Grid → screen 2×2 basis: sx = a·m11 + b·m21, sy = a·m12 + b·m22. */
  m11: number; m12: number; m21: number; m22: number;
  /** Vertical foreshortening for upright art, 1 at the default pitch. */
  up: number;
  /** Ground-circle y/x ratio, relative to the default pitch (so also 1). */
  flat: number;
}

export function makeCamera(gw: number, gh: number): Camera {
  const cam: Camera = {
    mode: 'iso',
    scale: 1,
    ox: 0,
    oy: 0,
    gw,
    gh,
    yaw: ISO_YAW,
    pitch: ISO_PITCH,
    m11: 0, m12: 0, m21: 0, m22: 0,
    up: 1,
    flat: 1,
  };
  return syncBasis(cam);
}

/**
 * Recompute the derived basis from mode / scale / yaw / pitch. Cheap
 * (four trig calls), called once per frame from `fitCamera` — never from
 * a draw routine.
 */
export function syncBasis(cam: Camera): Camera {
  if (cam.mode === 'tactical') {
    const t = TAC_TILE * cam.scale;
    cam.m11 = t; cam.m12 = 0;
    cam.m21 = 0; cam.m22 = t;
    cam.up = 1;
    cam.flat = 1;
    return cam;
  }
  const r = ORBIT_R * cam.scale;
  const c = Math.cos(cam.yaw);
  const s = Math.sin(cam.yaw);
  const k = Math.sin(cam.pitch);
  cam.m11 = r * c;
  cam.m21 = -r * s;
  cam.m12 = r * s * k;
  cam.m22 = r * c * k;
  cam.up = Math.cos(cam.pitch) / ISO_UP;
  cam.flat = k / ISO_FLAT;
  return cam;
}

/** Grid-space b coordinate of the centre of tile row `tileY`. */
export function gridB(cam: Camera, tileY: number): number {
  return cam.gh - 1 - tileY + 0.5;
}

/** Project a grid-space point into screen space, writing into `out`. */
export function project(cam: Camera, a: number, b: number, out: Point): Point {
  out.x = a * cam.m11 + b * cam.m21 + cam.ox;
  out.y = a * cam.m12 + b * cam.m22 + cam.oy;
  return out;
}

/** Project the centre of tile (x, y) — accepts fractional tiles so a
 *  moving actor can be interpolated between two tick positions. */
export function projectTile(cam: Camera, tileX: number, tileY: number, out: Point): Point {
  return project(cam, tileX + 0.5, cam.gh - 1 - tileY + 0.5, out);
}

/** Inverse projection: screen point → continuous grid space. */
export function unproject(cam: Camera, sx: number, sy: number, out: Point): Point {
  const det = cam.m11 * cam.m22 - cam.m21 * cam.m12;
  const u = sx - cam.ox;
  const v = sy - cam.oy;
  if (det === 0) { out.x = 0; out.y = 0; return out; }
  out.x = (u * cam.m22 - v * cam.m21) / det;
  out.y = (v * cam.m11 - u * cam.m12) / det;
  return out;
}

/** Screen point → tile, or null when it lands outside the playable box. */
export function screenToTile(cam: Camera, sx: number, sy: number, out: Point): Point | null {
  unproject(cam, sx, sy, out);
  const tx = Math.floor(out.x);
  const ty = cam.gh - 1 - Math.floor(out.y);
  if (tx < 0 || tx >= cam.gw || ty < 0 || ty >= cam.gh) return null;
  out.x = tx;
  out.y = ty;
  return out;
}

/**
 * Painter's-algorithm depth for a grid-space point; larger = nearer the
 * camera. It is the screen-y component of the projection, which is what
 * "further from the camera" means under any yaw — sorting on a fixed
 * a + b would put actors in the wrong order the moment the camera turns.
 */
export function depthOf(cam: Camera, a: number, b: number): number {
  return cam.mode === 'tactical' ? a + b : a * cam.m12 + b * cam.m22;
}

// ---------------------------------------------------------------- framing

export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

const WB: Bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

/**
 * Screen bounding box of the whole arena at scale 1, padding excluded.
 *
 * The projection is affine and the arena is the axis-aligned grid rect
 * [0, gw] × [0, gh], so each screen axis is a separable sum of the two
 * grid axes' contributions — no need to project four corners.
 */
export function worldBounds(
  mode: ViewMode, gw: number, gh: number,
  yaw = ISO_YAW, pitch = ISO_PITCH, out: Bounds = WB,
): Bounds {
  let m11: number; let m12: number; let m21: number; let m22: number;
  if (mode === 'tactical') {
    m11 = TAC_TILE; m12 = 0; m21 = 0; m22 = TAC_TILE;
  } else {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const k = Math.sin(pitch);
    m11 = ORBIT_R * c;
    m21 = -ORBIT_R * s;
    m12 = ORBIT_R * s * k;
    m22 = ORBIT_R * c * k;
  }
  const ax = gw * m11; const bx = gh * m21;
  const ay = gw * m12; const by = gh * m22;
  out.minX = Math.min(0, ax) + Math.min(0, bx);
  out.maxX = Math.max(0, ax) + Math.max(0, bx);
  out.minY = Math.min(0, ay) + Math.min(0, by);
  out.maxY = Math.max(0, ay) + Math.max(0, by);
  return out;
}

/** Unscaled world width of the whole arena, padding excluded. */
export function worldWidth(
  mode: ViewMode, gw: number, gh: number, yaw = ISO_YAW, pitch = ISO_PITCH,
): number {
  const b = worldBounds(mode, gw, gh, yaw, pitch, WB);
  return b.maxX - b.minX;
}

export function worldHeight(
  mode: ViewMode, gw: number, gh: number, yaw = ISO_YAW, pitch = ISO_PITCH,
): number {
  const b = worldBounds(mode, gw, gh, yaw, pitch, WB);
  return b.maxY - b.minY;
}

/** Screen-space x of grid (0,0) relative to the world's left edge. */
export function worldLeft(
  mode: ViewMode, gw: number, gh: number, scale: number,
  yaw = ISO_YAW, pitch = ISO_PITCH,
): number {
  return worldBounds(mode, gw, gh, yaw, pitch, WB).minX * scale;
}

/** Screen-space y of grid (0,0) relative to the world's top edge. */
export function worldTop(
  mode: ViewMode, gw: number, gh: number, scale: number,
  yaw = ISO_YAW, pitch = ISO_PITCH,
): number {
  return worldBounds(mode, gw, gh, yaw, pitch, WB).minY * scale;
}

export interface FitOptions {
  canvasW: number;
  canvasH: number;
  mode: ViewMode;
  /** User zoom multiplier on the fit scale. */
  zoom: number;
  /** Ease toward this grid-space point when zoomed past fit (null = centre). */
  focus: Point | null;
  /**
   * Grid-space rect that MUST stay on screen — typically the union of the
   * player and everything the current attack makes dangerous. When it
   * cannot fit at the requested zoom, the zoom is reduced until it does:
   * the camera is never allowed to hide a hazard the player must react to.
   *
   * Pass null once the user has taken manual control of the camera —
   * choosing to fly in close is their call, the way it is in the client.
   */
  required: { a0: number; b0: number; a1: number; b1: number } | null;
  /** Orbit pose. Omitted (or in tactical mode) means the classic iso view. */
  yaw?: number;
  pitch?: number;
}

/**
 * Fit the camera to the canvas. Mutates and returns `cam`; allocates
 * nothing, so it is safe to call every frame.
 */
export function fitCamera(cam: Camera, o: FitOptions): Camera {
  cam.mode = o.mode;
  // Tactical is a deliberately fixed top-down grid: no orbit applies.
  cam.yaw = o.mode === 'tactical' ? ISO_YAW : (o.yaw ?? ISO_YAW);
  cam.pitch = o.mode === 'tactical' ? ISO_PITCH : (o.pitch ?? ISO_PITCH);

  const padX = WORLD_PAD_SIDE * 2;
  const padY = o.mode === 'tactical'
    ? WORLD_PAD_BOTTOM * 2
    : WORLD_PAD_TOP + WORLD_PAD_BOTTOM;

  const wb = worldBounds(cam.mode, cam.gw, cam.gh, cam.yaw, cam.pitch, WB);
  const baseW = wb.maxX - wb.minX;
  const baseH = wb.maxY - wb.minY;
  const minX = wb.minX;
  const minY = wb.minY;
  const fit = Math.min(
    (o.canvasW - padX) / baseW,
    (o.canvasH - padY) / baseH,
  );
  const fitScale = Math.max(0.15, fit);

  let scale = fitScale * Math.max(0.1, o.zoom);
  // Shrink until the must-see rect fits, then frame it.
  if (o.required) {
    const rw = Math.abs(o.required.a1 - o.required.a0);
    const rh = Math.abs(o.required.b1 - o.required.b0);
    // Same separable trick as worldBounds, on the rect's own extents.
    const spanX = rw * Math.abs(baseM11(cam)) + rh * Math.abs(baseM21(cam));
    const spanY = rw * Math.abs(baseM12(cam)) + rh * Math.abs(baseM22(cam));
    if (spanX > 0 && spanY > 0) {
      const maxScale = Math.min(
        (o.canvasW - padX) / spanX,
        (o.canvasH - padY) / spanY,
      );
      if (maxScale > 0) scale = Math.min(scale, maxScale);
    }
  }
  cam.scale = scale;
  syncBasis(cam);

  // Centre the world, then pan toward the focus point if we are zoomed in.
  const wWidth = baseW * scale;
  const wHeight = baseH * scale;
  cam.ox = (o.canvasW - wWidth) / 2 - minX * scale;
  cam.oy = (o.canvasH - wHeight) / 2 - minY * scale
    + (o.mode === 'tactical' ? 0 : (WORLD_PAD_TOP - WORLD_PAD_BOTTOM) / 2);

  if (o.focus && wWidth > o.canvasW - padX) {
    project(cam, o.focus.x, o.focus.y, TMP_FIT);
    const slackX = Math.max(0, (wWidth - (o.canvasW - padX)) / 2);
    cam.ox += clamp(o.canvasW / 2 - TMP_FIT.x, -slackX, slackX);
  }
  if (o.focus && wHeight > o.canvasH - padY) {
    project(cam, o.focus.x, o.focus.y, TMP_FIT);
    const slackY = Math.max(0, (wHeight - (o.canvasH - padY)) / 2);
    cam.oy += clamp(o.canvasH / 2 - TMP_FIT.y, -slackY, slackY);
  }
  return cam;
}

// Unit-scale basis components for the current pose — used by the must-see
// clamp, which has to reason in scale-1 units before it picks a scale.
function baseM11(cam: Camera): number {
  return cam.mode === 'tactical' ? TAC_TILE : ORBIT_R * Math.cos(cam.yaw);
}
function baseM21(cam: Camera): number {
  return cam.mode === 'tactical' ? 0 : -ORBIT_R * Math.sin(cam.yaw);
}
function baseM12(cam: Camera): number {
  return cam.mode === 'tactical' ? 0 : ORBIT_R * Math.sin(cam.yaw) * Math.sin(cam.pitch);
}
function baseM22(cam: Camera): number {
  return cam.mode === 'tactical' ? TAC_TILE : ORBIT_R * Math.cos(cam.yaw) * Math.sin(cam.pitch);
}

const TMP_FIT: Point = { x: 0, y: 0 };

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ------------------------------------------------------- baked layers

/** A canvas transform in `setTransform(a, b, c, d, e, f)` order. */
export interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }

export function makeMat(): Mat { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }

/**
 * Transform that re-projects a layer baked with camera `from` so it lines
 * up with camera `to`.
 *
 * The whole point of baking the static arena is that it costs one blit
 * per frame. Orbiting would destroy that if every new angle needed a
 * re-bake — but the floor is a *plane*, and both cameras project it
 * affinely, so the live image of a baked floor is exactly the baked
 * bitmap pushed through `M_to · M_from⁻¹`. Tiles, grid lines and labels
 * stay pixel-exact at any angle from a bake taken at any other angle;
 * only extruded scenery is approximated, which is why the bake pose can
 * be quantised coarsely (see `CAMERA.BAKE_STEP_DEG`).
 *
 * When the two cameras share a basis this collapses to the plain
 * translation the renderer used before there was a camera to move.
 */
export function blitTransform(from: Camera, to: Camera, out: Mat): Mat {
  const det = from.m11 * from.m22 - from.m21 * from.m12;
  if (det === 0) {
    out.a = 1; out.b = 0; out.c = 0; out.d = 1;
    out.e = to.ox - from.ox;
    out.f = to.oy - from.oy;
    return out;
  }
  // M_from⁻¹, in the same (m11, m12, m21, m22) layout.
  const i11 = from.m22 / det;
  const i21 = -from.m21 / det;
  const i12 = -from.m12 / det;
  const i22 = from.m11 / det;
  // A = M_to · M_from⁻¹, written straight into canvas order.
  out.a = to.m11 * i11 + to.m21 * i12;
  out.c = to.m11 * i21 + to.m21 * i22;
  out.b = to.m12 * i11 + to.m22 * i12;
  out.d = to.m12 * i21 + to.m22 * i22;
  out.e = to.ox - (out.a * from.ox + out.c * from.oy);
  out.f = to.oy - (out.b * from.ox + out.d * from.oy);
  return out;
}

/** Copy `src` into `dst` — used to align the baked static layer. */
export function copyCamera(dst: Camera, src: Camera): Camera {
  dst.mode = src.mode;
  dst.scale = src.scale;
  dst.ox = src.ox;
  dst.oy = src.oy;
  dst.gw = src.gw;
  dst.gh = src.gh;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  return syncBasis(dst);
}

/**
 * One tile half-width in px — the unit every actor is measured in.
 *
 * Deliberately independent of yaw: actors must not grow and shrink as the
 * camera turns around them. Vertical foreshortening is `cam.up`, applied
 * separately.
 */
export function tileUnit(cam: Camera): number {
  return cam.mode === 'tactical' ? TAC_TILE * cam.scale * 0.5 : ISO_HW * cam.scale;
}
