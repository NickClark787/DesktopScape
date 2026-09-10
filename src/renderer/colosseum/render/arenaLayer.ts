/**
 * The static arena, baked once into an offscreen canvas and blitted with a
 * single `drawImage` per frame.
 *
 * This is the biggest performance lever in the renderer: floor grain, the
 * wall extrusion, four pillars, ~70 crowd silhouettes and (optionally) 240
 * tile labels add up to thousands of path ops that never change between
 * frames. Baking them means the per-frame cost of the entire environment
 * is one blit.
 *
 * The layer is baked in WORLD space (its own origin), so panning the
 * camera — following the player, for instance — only changes the blit
 * offset. A re-bake happens solely when scale, view mode, quality, the
 * coordinate toggle or the quantised orbit pose change.
 *
 * Orbiting does NOT force a re-bake per frame. The floor is a plane, so
 * the renderer re-projects the baked bitmap through the affine difference
 * between the baked pose and the live one (`blitTransform`): every tile
 * and grid line lands pixel-exact from a bake taken up to half a step
 * away. Only the extruded scenery below is approximate in between, and
 * only until the camera stops moving.
 *
 * All art here is original geometry: tapered columns, a wall lip, and
 * abstract spectator silhouettes built from circles and trapezoids. No
 * game assets are traced, sampled or reproduced.
 */
import { ARENA_H, ARENA_W } from '@sim/solHeredit/constants';
import { FONT_COORD } from '../../arena/hud';
import type { QualityProfile, ViewMode } from '../../arena/options';
import {
  ISO_HW, TAC_TILE, WORLD_PAD_BOTTOM, WORLD_PAD_SIDE, WORLD_PAD_TOP,
  makeCamera, project, syncBasis, worldBounds, type Camera, type Point,
} from '../../arena/projection';
import { areaPath, beginUpright, endUpright, tileHash, tilePath } from '../../arena/shapes';
import { C } from './palette';

const PT: Point = { x: 0, y: 0 };
const PT2: Point = { x: 0, y: 0 };
// Arena corner vertices, reused by the wall pass.
const V_NW: Point = { x: 0, y: 0 };
const V_NE: Point = { x: 0, y: 0 };
const V_SE: Point = { x: 0, y: 0 };
const V_SW: Point = { x: 0, y: 0 };

export interface ArenaLayer {
  canvas: HTMLCanvasElement;
  /** The camera this layer was baked with, origin included. The renderer
   *  needs it to re-project the bitmap onto the live camera. */
  cam: Camera;
  /** Bake key — compared to decide whether a re-bake is needed. */
  key: string;
}

/** How far outside the corner vertices the columns stand, in tiles, and
 *  their unscaled height. Both are bounded by the world padding — push
 *  them out further and the canvas edge starts clipping capitals. */
const PILLAR_OFF = 0.5;
const PILLAR_H = 104;

function bakeKey(
  mode: ViewMode, scale: number, dpr: number, quality: string, coords: boolean,
  yawDeg: number, pitchDeg: number,
): string {
  return `${mode}|${scale.toFixed(4)}|${dpr}|${quality}|${coords ? 1 : 0}|${yawDeg}|${pitchDeg}`;
}

/**
 * Bake (or reuse) the static layer. Returns the same object when nothing
 * relevant changed, so callers can call this every frame for free.
 *
 * `yawDeg` / `pitchDeg` should already be quantised by the caller
 * (`OrbitCamera.bakeYawDeg()` / `bakePitchDeg()`).
 */
export function ensureArenaLayer(
  prev: ArenaLayer | null,
  mode: ViewMode,
  scale: number,
  dpr: number,
  quality: QualityProfile,
  qualityName: string,
  showCoords: boolean,
  yawDeg: number,
  pitchDeg: number,
): ArenaLayer {
  const key = bakeKey(mode, scale, dpr, qualityName, showCoords, yawDeg, pitchDeg);
  if (prev && prev.key === key) return prev;

  const cam = prev?.cam ?? makeCamera(ARENA_W, ARENA_H);
  cam.mode = mode;
  cam.scale = scale;
  cam.yaw = yawDeg * DEG;
  cam.pitch = pitchDeg * DEG;
  syncBasis(cam);

  // Size the sheet to the arena's screen box at THIS pose — under an
  // orbit it is no longer the fixed diamond, so the bounds have to be
  // recomputed rather than assumed.
  const padTop = mode === 'tactical' ? WORLD_PAD_BOTTOM : WORLD_PAD_TOP;
  const b = worldBounds(mode, ARENA_W, ARENA_H, cam.yaw, cam.pitch);
  const w = (b.maxX - b.minX) * scale + WORLD_PAD_SIDE * 2;
  const h = (b.maxY - b.minY) * scale + padTop + WORLD_PAD_BOTTOM;

  const canvas = prev?.canvas ?? document.createElement('canvas');
  const pxW = Math.max(1, Math.ceil(w * dpr));
  const pxH = Math.max(1, Math.ceil(h * dpr));
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, cam, key };

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Origin shifted so the whole arena lands inside the padded box.
  cam.ox = WORLD_PAD_SIDE - b.minX * scale;
  cam.oy = padTop - b.minY * scale;

  if (mode === 'tactical') bakeTactical(ctx, cam, showCoords);
  else bakeIso(ctx, cam, scale, quality, showCoords);

  return { canvas, cam, key };
}

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- iso bake

function bakeIso(
  ctx: CanvasRenderingContext2D, cam: Camera, scale: number,
  q: QualityProfile, showCoords: boolean,
): void {
  drawCrowd(ctx, cam, scale, q);
  drawPillar(ctx, cam, scale, -PILLAR_OFF, -PILLAR_OFF, 1);                    // north-west, far
  drawPillar(ctx, cam, scale, ARENA_W + PILLAR_OFF, -PILLAR_OFF, 0.92);        // north-east
  drawPillar(ctx, cam, scale, -PILLAR_OFF, ARENA_H + PILLAR_OFF, 0.92);        // south-west
  drawWall(ctx, cam, scale);
  drawFloor(ctx, cam, scale, q);
  drawGrid(ctx, cam);
  // Near corner: a broken column. Kept short on purpose — a full-height
  // pillar here would sit between the camera and the fight.
  drawPillar(ctx, cam, scale, ARENA_W + PILLAR_OFF, ARENA_H + PILLAR_OFF, 0.42);
  if (showCoords) drawCoords(ctx, cam);
  drawAmbient(ctx, cam, scale);
}

function drawFloor(ctx: CanvasRenderingContext2D, cam: Camera, scale: number, q: QualityProfile): void {
  if (!q.richArena) {
    // Cheap path: one flat fill for the whole floor.
    ctx.beginPath();
    areaPath(ctx, cam, 0, 0, ARENA_W - 1, ARENA_H - 1);
    ctx.fillStyle = C.sandA;
    ctx.fill();
    return;
  }

  // Two batched passes — one path per tone — instead of a fill per tile.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        const n = tileHash(x, y);
        const tone = ((x + y) & 1) === 0 ? (n > 0.82 ? 1 : 0) : (n > 0.18 ? 1 : 0);
        if (tone !== pass) continue;
        tilePath(ctx, cam, x, y);
      }
    }
    ctx.fillStyle = pass === 0 ? C.sandA : C.sandB;
    ctx.fill();
  }

  // Grain: scattered specks of lighter sand, deterministic per tile so the
  // floor never shimmers when the layer is re-baked at a new zoom.
  ctx.fillStyle = C.sandGrain;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  const r = Math.max(0.7, 1.1 * scale);
  for (let x = 0; x < ARENA_W; x++) {
    for (let y = 0; y < ARENA_H; y++) {
      const n = tileHash(x, y);
      if (n < 0.55) continue;
      const jx = tileHash(x + 101, y);
      const jy = tileHash(x, y + 211);
      project(cam, x + 0.2 + jx * 0.6, ARENA_H - 1 - y + 0.2 + jy * 0.6, PT);
      ctx.moveTo(PT.x + r, PT.y);
      ctx.arc(PT.x, PT.y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let a = 0; a <= ARENA_W; a++) {
    project(cam, a, 0, PT);
    project(cam, a, ARENA_H, PT2);
    ctx.moveTo(PT.x, PT.y);
    ctx.lineTo(PT2.x, PT2.y);
  }
  for (let b = 0; b <= ARENA_H; b++) {
    project(cam, 0, b, PT);
    project(cam, ARENA_W, b, PT2);
    ctx.moveTo(PT.x, PT.y);
    ctx.lineTo(PT2.x, PT2.y);
  }
  ctx.stroke();
}

/** The stone lip around the playable box, extruded toward the viewer. */
function drawWall(ctx: CanvasRenderingContext2D, cam: Camera, scale: number): void {
  // Extrusion is vertical in world terms, so it foreshortens with pitch.
  const hgt = 13 * scale * cam.up;
  // Corner vertices, clockwise from the top (north-west) corner.
  const nw = project(cam, 0, 0, V_NW);
  const ne = project(cam, ARENA_W, 0, V_NE);
  const se = project(cam, ARENA_W, ARENA_H, V_SE);
  const sw = project(cam, 0, ARENA_H, V_SW);

  // Two near faces (south-east and south-west edges of the diamond).
  ctx.beginPath();
  ctx.moveTo(sw.x, sw.y);
  ctx.lineTo(se.x, se.y);
  ctx.lineTo(se.x, se.y + hgt);
  ctx.lineTo(sw.x, sw.y + hgt);
  ctx.closePath();
  ctx.fillStyle = C.wallFace;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(se.x, se.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(ne.x, ne.y + hgt);
  ctx.lineTo(se.x, se.y + hgt);
  ctx.closePath();
  ctx.fillStyle = C.wallFaceDark;
  ctx.fill();

  // Far lip: a thin band just outside the two up-screen edges.
  ctx.beginPath();
  ctx.moveTo(sw.x, sw.y);
  ctx.lineTo(nw.x, nw.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineWidth = Math.max(2, 5 * scale);
  ctx.strokeStyle = C.wallTop;
  ctx.stroke();

  // Gilt rule along the whole rim.
  ctx.beginPath();
  ctx.moveTo(nw.x, nw.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(se.x, se.y);
  ctx.lineTo(sw.x, sw.y);
  ctx.closePath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.wallGilt;
  ctx.stroke();
}

/**
 * One tapered column. `heightScale` < 0.5 renders it as a broken stump —
 * used at the near corner so the arena is framed without being hidden.
 */
function drawPillar(
  ctx: CanvasRenderingContext2D, cam: Camera, scale: number,
  a: number, b: number, heightScale: number,
): void {
  project(cam, a, b, PT);
  const bx = PT.x;
  const by = PT.y;
  const h = PILLAR_H * scale * heightScale;
  const w = 17 * scale;
  const topW = w * 0.84;
  const broken = heightScale < 0.5;

  // Plinth — flat on the ground, so it opens up with pitch rather than
  // shortening, and is drawn outside the upright squash below.
  ctx.beginPath();
  ctx.moveTo(bx, by - 5 * scale * cam.flat);
  ctx.lineTo(bx + w * 1.5, by + 3 * scale * cam.flat);
  ctx.lineTo(bx, by + 11 * scale * cam.flat);
  ctx.lineTo(bx - w * 1.5, by + 3 * scale * cam.flat);
  ctx.closePath();
  ctx.fillStyle = C.pillarShade;
  ctx.fill();

  const upright = beginUpright(ctx, by, cam.up);

  // Shaft: a lit face and a shaded face, split down the axis.
  ctx.beginPath();
  ctx.moveTo(bx - w, by);
  ctx.lineTo(bx, by + 4 * scale);
  ctx.lineTo(bx, by - h + 4 * scale);
  ctx.lineTo(bx - topW, by - h);
  ctx.closePath();
  ctx.fillStyle = C.pillarLit;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(bx + w, by);
  ctx.lineTo(bx, by + 4 * scale);
  ctx.lineTo(bx, by - h + 4 * scale);
  ctx.lineTo(bx + topW, by - h);
  ctx.closePath();
  ctx.fillStyle = C.pillarDark;
  ctx.fill();

  // Fluting.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.lineWidth = Math.max(1, 1.4 * scale);
  ctx.beginPath();
  for (const t of [-0.55, -0.2, 0.2, 0.55]) {
    ctx.moveTo(bx + w * t, by + 2 * scale);
    ctx.lineTo(bx + topW * t, by - h + 2 * scale);
  }
  ctx.stroke();

  if (broken) {
    // Ragged top instead of a capital.
    ctx.beginPath();
    ctx.moveTo(bx - topW, by - h);
    ctx.lineTo(bx - topW * 0.4, by - h + 5 * scale);
    ctx.lineTo(bx + topW * 0.1, by - h - 4 * scale);
    ctx.lineTo(bx + topW, by - h + 2 * scale);
    ctx.lineTo(bx, by - h + 9 * scale);
    ctx.closePath();
    ctx.fillStyle = C.pillarShade;
    ctx.fill();
    endUpright(ctx, upright);
    return;
  }

  // Gold band.
  ctx.fillStyle = C.pillarBand;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(bx - w, by - h * 0.62, w * 2, Math.max(2, 4 * scale));
  ctx.globalAlpha = 1;

  // Capital.
  const cw = w * 1.45;
  ctx.beginPath();
  ctx.moveTo(bx - cw, by - h);
  ctx.lineTo(bx, by - h - 7 * scale);
  ctx.lineTo(bx + cw, by - h);
  ctx.lineTo(bx, by - h + 7 * scale);
  ctx.closePath();
  ctx.fillStyle = C.pillarLit;
  ctx.fill();
  ctx.strokeStyle = C.pillarBand;
  ctx.lineWidth = 1;
  ctx.stroke();
  endUpright(ctx, upright);
}

/**
 * Spectator barricade along the two far edges: abstract silhouettes, not
 * characters — a head, a tapered torso, and sometimes a raised spear or a
 * round shield. Height and props vary by a stable per-slot hash.
 */
function drawCrowd(ctx: CanvasRenderingContext2D, cam: Camera, scale: number, q: QualityProfile): void {
  if (!q.richArena) {
    // Flat band along both far edges: the same silhouette read, one fill.
    const band = 24 * scale * cam.up;
    const w = project(cam, 0, ARENA_H, PT);
    const wx = w.x; const wy = w.y;
    const n = project(cam, 0, -0.9, PT2);
    const nx = n.x; const ny = n.y;
    const e = project(cam, ARENA_W, -0.9, PT);
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(nx, ny);
    ctx.lineTo(e.x, e.y);
    ctx.lineTo(e.x, e.y - band);
    ctx.lineTo(nx, ny - band);
    ctx.lineTo(wx, wy - band);
    ctx.closePath();
    ctx.fillStyle = C.crowdFar;
    ctx.fill();
    return;
  }

  const step = 0.62;
  for (let i = 0; i * step <= ARENA_W; i++) {
    drawSpectator(ctx, cam, scale, i * step, -0.85, i);
  }
  for (let i = 1; i * step <= ARENA_H; i++) {
    drawSpectator(ctx, cam, scale, -0.85, i * step, i + 97);
  }
}

function drawSpectator(
  ctx: CanvasRenderingContext2D, cam: Camera, scale: number,
  a: number, b: number, seed: number,
): void {
  const n = tileHash(seed, 7);
  const n2 = tileHash(seed, 31);
  project(cam, a, b, PT);
  const x = PT.x;
  const y = PT.y;
  const h = (20 + n * 9) * scale;
  const w = (5.2 + n2 * 1.6) * scale;
  const upright = beginUpright(ctx, y, cam.up);

  ctx.fillStyle = n2 > 0.5 ? C.crowdNear : C.crowdFar;
  // Torso: a trapezoid narrowing at the shoulders.
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w * 0.66, y - h * 0.72);
  ctx.lineTo(x - w * 0.66, y - h * 0.72);
  ctx.closePath();
  ctx.fill();
  // Head.
  ctx.beginPath();
  ctx.arc(x, y - h * 0.86, w * 0.55, 0, Math.PI * 2);
  ctx.fill();

  if (n > 0.72) {
    // Raised spear.
    ctx.strokeStyle = n2 > 0.6 ? C.crowdGlint : C.crowdNear;
    ctx.lineWidth = Math.max(1, 1.4 * scale);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.9, y - h * 0.2);
    ctx.lineTo(x + w * 1.3, y - h * 1.6);
    ctx.stroke();
  } else if (n < 0.22) {
    // Round shield held up.
    ctx.beginPath();
    ctx.arc(x - w * 0.9, y - h * 0.5, w * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = C.crowdNear;
    ctx.fill();
  }
  endUpright(ctx, upright);
}

function drawCoords(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.font = FONT_COORD;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(244, 234, 209, 0.30)';
  for (let x = 0; x < ARENA_W; x++) {
    for (let y = 0; y < ARENA_H; y++) {
      project(cam, x + 0.5, ARENA_H - 1 - y + 0.5, PT);
      ctx.fillText(`${x},${y}`, PT.x, PT.y + 3);
    }
  }
}

/** Warm torch-light pooling toward the arena centre. */
function drawAmbient(ctx: CanvasRenderingContext2D, cam: Camera, scale: number): void {
  project(cam, ARENA_W / 2, ARENA_H / 2, PT);
  const r = (ARENA_W + ARENA_H) * ISO_HW * scale * 0.5;
  const g = ctx.createRadialGradient(PT.x, PT.y - r * 0.15, 0, PT.x, PT.y, r);
  g.addColorStop(0, 'rgba(255, 208, 130, 0.09)');
  g.addColorStop(0.6, 'rgba(255, 170, 80, 0.035)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  areaPath(ctx, cam, 0, 0, ARENA_W - 1, ARENA_H - 1);
  ctx.fill();
}

// ------------------------------------------------------------ tactical bake

/** Flat grid: the cheapest possible arena, and the clearest for drilling
 *  footwork. No pillars, no crowd, no grain, no gradients. */
function bakeTactical(ctx: CanvasRenderingContext2D, cam: Camera, showCoords: boolean): void {
  project(cam, 0, 0, PT);
  project(cam, ARENA_W, ARENA_H, PT2);
  ctx.fillStyle = C.sandA;
  ctx.fillRect(PT.x, PT.y, PT2.x - PT.x, PT2.y - PT.y);

  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let a = 0; a <= ARENA_W; a++) {
    project(cam, a, 0, PT);
    project(cam, a, ARENA_H, PT2);
    ctx.moveTo(Math.round(PT.x) + 0.5, PT.y);
    ctx.lineTo(Math.round(PT2.x) + 0.5, PT2.y);
  }
  for (let b = 0; b <= ARENA_H; b++) {
    project(cam, 0, b, PT);
    project(cam, ARENA_W, b, PT2);
    ctx.moveTo(PT.x, Math.round(PT.y) + 0.5);
    ctx.lineTo(PT2.x, Math.round(PT2.y) + 0.5);
  }
  ctx.stroke();

  // Every 5th line brighter, so tile counting stays easy at a glance.
  ctx.strokeStyle = C.gridStrong;
  ctx.beginPath();
  for (let a = 0; a <= ARENA_W; a += 5) {
    project(cam, a, 0, PT);
    project(cam, a, ARENA_H, PT2);
    ctx.moveTo(Math.round(PT.x) + 0.5, PT.y);
    ctx.lineTo(Math.round(PT2.x) + 0.5, PT2.y);
  }
  for (let b = 0; b <= ARENA_H; b += 5) {
    project(cam, 0, b, PT);
    project(cam, ARENA_W, b, PT2);
    ctx.moveTo(PT.x, Math.round(PT.y) + 0.5);
    ctx.lineTo(PT2.x, Math.round(PT2.y) + 0.5);
  }
  ctx.stroke();

  ctx.strokeStyle = C.wallGilt;
  ctx.lineWidth = 2;
  project(cam, 0, 0, PT);
  project(cam, ARENA_W, ARENA_H, PT2);
  ctx.strokeRect(PT.x, PT.y, PT2.x - PT.x, PT2.y - PT.y);

  if (showCoords) {
    ctx.font = FONT_COORD;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(244, 234, 209, 0.32)';
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        project(cam, x + 0.5, ARENA_H - 1 - y + 0.5, PT);
        ctx.fillText(`${x},${y}`, PT.x, PT.y + 3);
      }
    }
  }
}

/** Unscaled tile footprint, for callers that need pixel sizes. */
export function tilePixelWidth(cam: Camera): number {
  return cam.mode === 'tactical' ? TAC_TILE * cam.scale : ISO_HW * cam.scale * 2;
}
