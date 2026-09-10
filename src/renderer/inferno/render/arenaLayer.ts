/**
 * The static Zuk platform, baked once into an offscreen canvas and
 * blitted with a single `drawImage` per frame.
 *
 * Same discipline as the Colosseum layer: floor grain, the rim extrusion,
 * the lava moat and the spectator silhouettes are thousands of path ops
 * that never change between frames, so they are baked in WORLD space and
 * only re-baked when scale, view mode, quality or the coordinate toggle
 * change. Panning the camera just changes the blit offset.
 *
 * All art is original geometry: basalt tiles with ember cracks, an
 * extruded rim over a lava moat, and abstract crowd shapes. No game
 * assets are traced, sampled or reproduced.
 */
import { ARENA_H, ARENA_W, ZUK_SIZE } from '@sim/tzkalZuk/constants';
import { FONT_COORD } from '../../arena/hud';
import type { QualityProfile, ViewMode } from '../../arena/options';
import {
  ISO_HW, WORLD_PAD_BOTTOM, WORLD_PAD_SIDE, WORLD_PAD_TOP,
  makeCamera, project, syncBasis, worldBounds, type Camera, type Point,
} from '../../arena/projection';
import { areaPath, beginUpright, endUpright, tileHash, tilePath } from '../../arena/shapes';
import { C } from './palette';

const PT: Point = { x: 0, y: 0 };
const PT2: Point = { x: 0, y: 0 };
const V_NW: Point = { x: 0, y: 0 };
const V_NE: Point = { x: 0, y: 0 };
const V_SE: Point = { x: 0, y: 0 };
const V_SW: Point = { x: 0, y: 0 };

export interface ArenaLayer {
  canvas: HTMLCanvasElement;
  /** The camera this layer was baked with, origin included. */
  cam: Camera;
  key: string;
}

function bakeKey(
  mode: ViewMode, scale: number, dpr: number, quality: string, coords: boolean,
  yawDeg: number, pitchDeg: number,
): string {
  return `${mode}|${scale.toFixed(4)}|${dpr}|${quality}|${coords ? 1 : 0}|${yawDeg}|${pitchDeg}`;
}

/** `yawDeg` / `pitchDeg` arrive already quantised (`CAMERA.BAKE_STEP_DEG`). */
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

  // The platform's screen box depends on the pose, so measure it.
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
  drawLavaMoat(ctx, cam, scale, q);
  drawCrowd(ctx, cam, scale, q);
  drawRim(ctx, cam, scale);
  drawFloor(ctx, cam, scale, q);
  drawGrid(ctx, cam);
  drawZukDais(ctx, cam, scale, q);
  if (showCoords) drawCoords(ctx, cam);
  drawAmbient(ctx, cam, scale);
}

/** A ring of magma around the platform, fading into the dark. */
function drawLavaMoat(ctx: CanvasRenderingContext2D, cam: Camera, scale: number, q: QualityProfile): void {
  const spread = 2.6;
  ctx.beginPath();
  project(cam, -spread, -spread, PT); ctx.moveTo(PT.x, PT.y);
  project(cam, ARENA_W + spread, -spread, PT); ctx.lineTo(PT.x, PT.y);
  project(cam, ARENA_W + spread, ARENA_H + spread, PT); ctx.lineTo(PT.x, PT.y);
  project(cam, -spread, ARENA_H + spread, PT); ctx.lineTo(PT.x, PT.y);
  ctx.closePath();
  ctx.fillStyle = C.lavaDeep;
  ctx.fill();

  if (!q.richArena) return;

  // Molten veins: deterministic streaks so the moat never shimmers.
  ctx.strokeStyle = C.lavaMid;
  ctx.lineWidth = Math.max(1.5, 3 * scale);
  ctx.beginPath();
  for (let i = 0; i < 46; i++) {
    const n = tileHash(i, 5);
    const n2 = tileHash(i, 17);
    const along = n * (ARENA_W + spread * 2) - spread;
    const side = i % 4;
    const off = spread * (0.25 + n2 * 0.6);
    if (side === 0) { project(cam, along, -off, PT); project(cam, along + 0.8, -off * 0.7, PT2); }
    else if (side === 1) { project(cam, along, ARENA_H + off, PT); project(cam, along + 0.8, ARENA_H + off * 0.7, PT2); }
    else if (side === 2) { project(cam, -off, along * 0.72, PT); project(cam, -off * 0.7, along * 0.72 + 0.8, PT2); }
    else { project(cam, ARENA_W + off, along * 0.72, PT); project(cam, ARENA_W + off * 0.7, along * 0.72 + 0.8, PT2); }
    ctx.moveTo(PT.x, PT.y);
    ctx.lineTo(PT2.x, PT2.y);
  }
  ctx.stroke();
}

function drawFloor(ctx: CanvasRenderingContext2D, cam: Camera, scale: number, q: QualityProfile): void {
  if (!q.richArena) {
    ctx.beginPath();
    areaPath(ctx, cam, 0, 0, ARENA_W - 1, ARENA_H - 1);
    ctx.fillStyle = C.rockA;
    ctx.fill();
    return;
  }

  // Two batched tone passes — one path per tone, not one fill per tile.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        const n = tileHash(x, y);
        const tone = ((x + y) & 1) === 0 ? (n > 0.8 ? 1 : 0) : (n > 0.2 ? 1 : 0);
        if (tone !== pass) continue;
        tilePath(ctx, cam, x, y);
      }
    }
    ctx.fillStyle = pass === 0 ? C.rockA : C.rockB;
    ctx.fill();
  }

  // Ember cracks glowing up through the basalt.
  ctx.strokeStyle = C.rockCrack;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, 1.6 * scale);
  ctx.beginPath();
  for (let x = 0; x < ARENA_W; x++) {
    for (let y = 0; y < ARENA_H; y++) {
      if (tileHash(x, y) < 0.86) continue;
      const jx = tileHash(x + 31, y);
      project(cam, x + 0.15 + jx * 0.2, ARENA_H - 1 - y + 0.2, PT);
      project(cam, x + 0.55 + jx * 0.3, ARENA_H - 1 - y + 0.85, PT2);
      ctx.moveTo(PT.x, PT.y);
      ctx.lineTo(PT2.x, PT2.y);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Fine grain.
  ctx.fillStyle = C.rockGrain;
  ctx.globalAlpha = 0.13;
  ctx.beginPath();
  const r = Math.max(0.7, 1.1 * scale);
  for (let x = 0; x < ARENA_W; x++) {
    for (let y = 0; y < ARENA_H; y++) {
      if (tileHash(x, y + 77) < 0.6) continue;
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

/** The platform's extruded rim, glowing where it meets the moat. */
function drawRim(ctx: CanvasRenderingContext2D, cam: Camera, scale: number): void {
  // Vertical extrusion, so it foreshortens with camera pitch.
  const hgt = 15 * scale * cam.up;
  const nw = project(cam, 0, 0, V_NW);
  const ne = project(cam, ARENA_W, 0, V_NE);
  const se = project(cam, ARENA_W, ARENA_H, V_SE);
  const sw = project(cam, 0, ARENA_H, V_SW);

  ctx.beginPath();
  ctx.moveTo(sw.x, sw.y);
  ctx.lineTo(se.x, se.y);
  ctx.lineTo(se.x, se.y + hgt);
  ctx.lineTo(sw.x, sw.y + hgt);
  ctx.closePath();
  ctx.fillStyle = C.rimFace;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(se.x, se.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(ne.x, ne.y + hgt);
  ctx.lineTo(se.x, se.y + hgt);
  ctx.closePath();
  ctx.fillStyle = C.rimFaceDark;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(sw.x, sw.y);
  ctx.lineTo(nw.x, nw.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineWidth = Math.max(2, 5 * scale);
  ctx.strokeStyle = C.rimTop;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(nw.x, nw.y);
  ctx.lineTo(ne.x, ne.y);
  ctx.lineTo(se.x, se.y);
  ctx.lineTo(sw.x, sw.y);
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = C.rimGlow;
  ctx.stroke();
}

/** A raised, seared slab under Zuk's 7×7 footprint. */
function drawZukDais(ctx: CanvasRenderingContext2D, cam: Camera, scale: number, q: QualityProfile): void {
  const zx0 = Math.floor((ARENA_W - ZUK_SIZE) / 2);
  const y0 = ARENA_H - ZUK_SIZE;
  ctx.beginPath();
  areaPath(ctx, cam, zx0, y0, zx0 + ZUK_SIZE - 1, ARENA_H - 1);
  ctx.fillStyle = 'rgba(120, 40, 6, 0.35)';
  ctx.fill();
  ctx.strokeStyle = C.rimGlow;
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.stroke();
  if (!q.richArena) return;
  // Scorch rings radiating from where he stands.
  ctx.strokeStyle = 'rgba(194, 59, 6, 0.30)';
  ctx.lineWidth = Math.max(1, 1.4 * scale);
  project(cam, zx0 + ZUK_SIZE / 2, ARENA_H - ZUK_SIZE / 2, PT);
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(PT.x, PT.y, ISO_HW * scale * i * 1.5, ISO_HW * scale * i * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * TzHaar spectators beyond the moat: abstract silhouettes, not
 * characters — a squat body, a head, and sometimes a raised arm.
 */
function drawCrowd(ctx: CanvasRenderingContext2D, cam: Camera, scale: number, q: QualityProfile): void {
  if (!q.richArena) {
    const band = 22 * scale * cam.up;
    const w = project(cam, 0, ARENA_H, PT);
    const wx = w.x; const wy = w.y;
    const n = project(cam, 0, -1.9, PT2);
    const nx = n.x; const ny = n.y;
    const e = project(cam, ARENA_W, -1.9, PT);
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

  const step = 0.7;
  for (let i = 0; i * step <= ARENA_W; i++) drawSpectator(ctx, cam, scale, i * step, -1.85, i);
  for (let i = 1; i * step <= ARENA_H; i++) drawSpectator(ctx, cam, scale, -1.85, i * step, i + 97);
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
  const h = (17 + n * 8) * scale;
  const w = (5.5 + n2 * 1.8) * scale;
  const upright = beginUpright(ctx, y, cam.up);

  ctx.fillStyle = n2 > 0.5 ? C.crowdNear : C.crowdFar;
  // Squat, heavy body — TzHaar read as blocky, not lithe.
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w * 0.8, y - h * 0.7);
  ctx.lineTo(x - w * 0.8, y - h * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y - h * 0.85, w * 0.5, 0, Math.PI * 2);
  ctx.fill();

  if (n > 0.78) {
    ctx.strokeStyle = C.crowdGlint;
    ctx.lineWidth = Math.max(1, 1.4 * scale);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.7, y - h * 0.55);
    ctx.lineTo(x + w * 1.3, y - h * 1.15);
    ctx.stroke();
  }
  endUpright(ctx, upright);
}

function drawCoords(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.font = FONT_COORD;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 200, 150, 0.28)';
  for (let x = 0; x < ARENA_W; x++) {
    for (let y = 0; y < ARENA_H; y++) {
      project(cam, x + 0.5, ARENA_H - 1 - y + 0.5, PT);
      ctx.fillText(`${x},${y}`, PT.x, PT.y + 3);
    }
  }
}

/** Heat glow pooling toward Zuk's end of the platform. */
function drawAmbient(ctx: CanvasRenderingContext2D, cam: Camera, scale: number): void {
  project(cam, ARENA_W / 2, ARENA_H * 0.3, PT);
  const r = (ARENA_W + ARENA_H) * ISO_HW * scale * 0.5;
  const g = ctx.createRadialGradient(PT.x, PT.y, 0, PT.x, PT.y, r);
  g.addColorStop(0, 'rgba(255, 130, 40, 0.13)');
  g.addColorStop(0.55, 'rgba(255, 90, 26, 0.05)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  areaPath(ctx, cam, 0, 0, ARENA_W - 1, ARENA_H - 1);
  ctx.fill();
}

// ------------------------------------------------------------ tactical bake

/** Flat grid: the cheapest arena, and the clearest for drilling the
 *  glyph shuffle — column alignment is all that matters there. */
function bakeTactical(ctx: CanvasRenderingContext2D, cam: Camera, showCoords: boolean): void {
  project(cam, 0, 0, PT);
  project(cam, ARENA_W, ARENA_H, PT2);
  ctx.fillStyle = C.rockA;
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

  // Zuk's slab, so his firing side is obvious even flattened.
  ctx.beginPath();
  const zx0 = Math.floor((ARENA_W - ZUK_SIZE) / 2);
  areaPath(ctx, cam, zx0, ARENA_H - ZUK_SIZE, zx0 + ZUK_SIZE - 1, ARENA_H - 1);
  ctx.fillStyle = 'rgba(120, 40, 6, 0.35)';
  ctx.fill();

  ctx.strokeStyle = C.rimGlow;
  ctx.lineWidth = 2;
  project(cam, 0, 0, PT);
  project(cam, ARENA_W, ARENA_H, PT2);
  ctx.strokeRect(PT.x, PT.y, PT2.x - PT.x, PT2.y - PT.y);

  if (showCoords) {
    ctx.font = FONT_COORD;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 200, 150, 0.3)';
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        project(cam, x + 0.5, ARENA_H - 1 - y + 0.5, PT);
        ctx.fillText(`${x},${y}`, PT.x, PT.y + 3);
      }
    }
  }
}
