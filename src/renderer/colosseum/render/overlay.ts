/**
 * Everything drawn on or just above the floor: molten sand, hazard tiles,
 * safe rings, light beams, click markers, and the pooled effects.
 *
 * Hazard tiles come straight out of `SimSnapshot.hazardTiles` — the exact
 * set the engine will test the player's tile against one tick later. The
 * renderer never derives a shape, so what is drawn and what hurts cannot
 * drift apart.
 *
 * Batching matters here: a shield slam marks ~230 tiles, so every tile
 * pass builds ONE path and issues ONE fill.
 */
import { ARENA_H, ARENA_W } from '@sim/solHeredit/constants';
import type { SimSnapshot } from '@sim/solHeredit/types';
import type { FrameContext } from '../../arena/frame';
import { FONT_HUD_SM, FONT_SPLAT, HUD } from '../../arena/hud';
import { project, projectTile, type Point } from '../../arena/projection';
import { numStr, outlinedText, roundRectPath, tilePath, type TileMask, type TileSetCache } from '../../arena/shapes';
import { C, type ColosseumGradients } from './palette';

type Frame = FrameContext & { grad: ColosseumGradients };

const PT: Point = { x: 0, y: 0 };

export interface TerrainCaches {
  hazard: TileSetCache;
  sand: TileSetCache;
  hazardMask: TileMask;
  sandMask: TileMask;
}

/** Refresh the decoded tile caches. Cheap no-op when nothing changed. */
export function syncTerrain(caches: TerrainCaches, s: SimSnapshot): void {
  caches.hazard.sync(s.hazardTiles);
  caches.sand.sync(s.sandTiles);
  caches.hazardMask.fromCache(caches.hazard);
  caches.sandMask.fromCache(caches.sand);
}

/** Molten sand: persistent terrain that shrinks the usable arena. */
export function drawSand(ctx: CanvasRenderingContext2D, f: Frame, caches: TerrainCaches): void {
  const n = caches.sand.count;
  if (n === 0) return;

  ctx.beginPath();
  for (let i = 0; i < n; i++) tilePath(ctx, f.cam, caches.sand.xs[i], caches.sand.ys[i]);
  ctx.fillStyle = C.sandCrust;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < n; i++) tilePath(ctx, f.cam, caches.sand.xs[i], caches.sand.ys[i], 0.14);
  ctx.fillStyle = C.sand;
  ctx.fill();

  // Molten cores pulse slowly so sand reads as live terrain, not decor.
  const pulse = f.animating ? 0.55 + Math.sin(f.now / 700) * 0.18 : 0.6;
  ctx.globalAlpha = pulse;
  ctx.beginPath();
  for (let i = 0; i < n; i++) tilePath(ctx, f.cam, caches.sand.xs[i], caches.sand.ys[i], 0.33);
  ctx.fillStyle = C.sandHot;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Declared hazard tiles plus, when the assist is on, an unmistakable
 * danger fill and a green safe wash.
 *
 * The base dust pass is NOT an assist: Sol's slams throw visible dust in
 * game, and hiding the shape would make the sim teach the wrong thing.
 * The assist adds the hard edge and the safe-tile highlight.
 */
export function drawHazards(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot,
  caches: TerrainCaches, hazardAssist: boolean, safeAssist: boolean,
): void {
  const n = caches.hazard.count;
  if (n === 0) return;

  // How close the impact is, from engine ticks alone: the fill brightens
  // as the resolve tick approaches so "it lands NOW" is unmissable.
  const declare = s.bossAttackDeclareTick;
  const resolve = s.bossAttackResolveTick;
  const span = Math.max(1, resolve - declare);
  const heat = Math.max(0, Math.min(1, (f.t - declare) / span));

  ctx.beginPath();
  for (let i = 0; i < n; i++) tilePath(ctx, f.cam, caches.hazard.xs[i], caches.hazard.ys[i]);
  ctx.fillStyle = hazardAssist ? C.hazardStrong : C.hazard;
  ctx.globalAlpha = 0.5 + heat * 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;

  // The boundary between "this hurts" and "this does not" — one stroked
  // path over only the edges where a hazard tile meets a safe one. For a
  // shield slam this traces the 9×9 / 11×11 safe corridor exactly, which
  // is the single most important line on the screen. Not an assist: it is
  // the edge of the dust the engine already told us about.
  boundaryPath(ctx, f, caches);
  ctx.strokeStyle = C.hazardEdge;
  ctx.lineWidth = Math.max(1.5, f.u * 0.11);
  ctx.globalAlpha = 0.6 + heat * 0.4;
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (hazardAssist) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) tilePath(ctx, f.cam, caches.hazard.xs[i], caches.hazard.ys[i], 0.06);
    ctx.strokeStyle = C.hazardEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (safeAssist) {
    ctx.beginPath();
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        if (caches.hazardMask.has(x, y) || caches.sandMask.has(x, y)) continue;
        tilePath(ctx, f.cam, x, y, 0.08);
      }
    }
    ctx.fillStyle = C.safe;
    ctx.fill();
    ctx.strokeStyle = C.safeEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * Build a path over only those tile edges where a hazard tile borders a
 * non-hazard tile inside the arena. Arena-edge borders are skipped: they
 * would just re-trace the wall and add nothing.
 *
 * One path, one stroke, no allocation — the four corner points are
 * projected into module scratch.
 */
function boundaryPath(ctx: CanvasRenderingContext2D, f: Frame, caches: TerrainCaches): void {
  const cam = f.cam;
  const mask = caches.hazardMask;
  ctx.beginPath();
  for (let i = 0; i < caches.hazard.count; i++) {
    const x = caches.hazard.xs[i];
    const y = caches.hazard.ys[i];
    const a0 = x;
    const a1 = x + 1;
    const b0 = ARENA_H - 1 - y;
    const b1 = b0 + 1;
    // East neighbour → the a = x+1 edge.
    if (x + 1 < ARENA_W && !mask.has(x + 1, y)) edge(ctx, cam, a1, b0, a1, b1);
    // West neighbour → the a = x edge.
    if (x - 1 >= 0 && !mask.has(x - 1, y)) edge(ctx, cam, a0, b0, a0, b1);
    // North neighbour (tile y+1) → the b = b0 edge.
    if (y + 1 < ARENA_H && !mask.has(x, y + 1)) edge(ctx, cam, a0, b0, a1, b0);
    // South neighbour (tile y-1) → the b = b1 edge.
    if (y - 1 >= 0 && !mask.has(x, y - 1)) edge(ctx, cam, a0, b1, a1, b1);
  }
}

function edge(
  ctx: CanvasRenderingContext2D, cam: FrameContext['cam'],
  a0: number, b0: number, a1: number, b1: number,
): void {
  project(cam, a0, b0, PT);
  const x0 = PT.x;
  const y0 = PT.y;
  project(cam, a1, b1, PT);
  ctx.moveTo(x0, y0);
  ctx.lineTo(PT.x, PT.y);
}

/**
 * Phase-transition light beams: a shaft of light on the tile, a countdown
 * to the launch, and — two ticks in — the molten sand it leaves behind.
 */
export function drawBeams(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  const u = f.u;
  for (let i = 0; i < s.beams.length; i++) {
    const b = s.beams[i];
    if (b.done) continue;
    const ticksLeft = b.fireTick - f.t;
    if (ticksLeft < -1) continue;
    projectTile(f.cam, b.pos.x, b.pos.y, PT);

    // Ground pool.
    ctx.beginPath();
    tilePath(ctx, f.cam, b.pos.x, b.pos.y, 0.08);
    ctx.fillStyle = C.beamGround;
    ctx.fill();
    ctx.strokeStyle = C.beam;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Shaft: narrows and brightens as the launch approaches.
    const t01 = Math.max(0, Math.min(1, 1 - ticksLeft / 4));
    const halfW = u * (0.55 - t01 * 0.28);
    const hgt = u * (4.5 + t01 * 2.5);
    if (f.q.glows && f.grad.beamShaft) {
      ctx.save();
      ctx.translate(PT.x, PT.y);
      ctx.globalAlpha = 0.45 + t01 * 0.45;
      ctx.fillStyle = f.grad.beamShaft;
      ctx.fillRect(-halfW, -hgt, halfW * 2, hgt);
      ctx.restore();
    } else {
      ctx.fillStyle = C.beam;
      ctx.globalAlpha = 0.3 + t01 * 0.4;
      ctx.fillRect(PT.x - halfW, PT.y - hgt, halfW * 2, hgt);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = C.beamCore;
    ctx.globalAlpha = 0.5 + t01 * 0.5;
    ctx.fillRect(PT.x - halfW * 0.28, PT.y - hgt, halfW * 0.56, hgt);
    ctx.globalAlpha = 1;

    const countdown = Math.max(0, Math.ceil(ticksLeft));
    outlinedText(ctx, numStr(countdown), PT.x, PT.y + u * 0.18, C.beamCore, FONT_SPLAT);
  }
}

/**
 * Click marker plus the in-flight ghost. The solid marker is where the
 * engine has the player walking; the dashed ghost is a click the server
 * has not processed yet — the visible face of ping.
 */
export function drawMarkers(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, showLatency: boolean,
): void {
  const u = f.u;
  if (s.playerMoveTarget) {
    projectTile(f.cam, s.playerMoveTarget.x, s.playerMoveTarget.y, PT);
    ctx.strokeStyle = C.clickMarker;
    ctx.lineWidth = Math.max(1.5, u * 0.10);
    const r = u * 0.30;
    ctx.beginPath();
    ctx.moveTo(PT.x - r, PT.y - r * 0.5);
    ctx.lineTo(PT.x + r, PT.y + r * 0.5);
    ctx.moveTo(PT.x + r, PT.y - r * 0.5);
    ctx.lineTo(PT.x - r, PT.y + r * 0.5);
    ctx.stroke();
  }

  if (showLatency && s.pendingMoveTarget) {
    projectTile(f.cam, s.pendingMoveTarget.x, s.pendingMoveTarget.y, PT);
    ctx.save();
    ctx.setLineDash(DASH);
    ctx.strokeStyle = C.ghostMarker;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    tilePath(ctx, f.cam, s.pendingMoveTarget.x, s.pendingMoveTarget.y, 0.16);
    ctx.stroke();
    ctx.restore();
    if (s.lastInputLagTicks > 1) {
      const i = Math.min(LAG_LABELS.length - 1, s.lastInputLagTicks);
      outlinedText(ctx, LAG_LABELS[i], PT.x, PT.y - u * 0.35, HUD.dim, FONT_HUD_SM);
    }
  }
}

const DASH = [4, 3];
/** Pre-built so the marker pass stays allocation-free. */
const LAG_LABELS = ['+0t', '+1t', '+2t', '+3t', '+4t', '+5t', '+6t', '+7t', '+8t', '+9t', '+9t+'];

// --------------------------------------------------------- transition wash

/** Full-canvas warm wash during a phase transition. Low alpha, slow — a
 *  readable state change, not a strobe. */
export function drawTransitionWash(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, w: number, h: number,
): void {
  if (s.transitionEndTick < 0) return;
  const remaining = s.transitionEndTick - f.t;
  if (remaining <= 0) return;
  // Pre-built strings: building `rgba(...)` here would allocate per frame.
  const step = Math.min(WASH_STEPS.length - 1, Math.max(0, Math.round(remaining)));
  ctx.fillStyle = WASH_STEPS[step];
  ctx.fillRect(0, 0, w, h);
}

const WASH_STEPS = [
  'rgba(255, 190, 90, 0.00)',
  'rgba(255, 190, 90, 0.04)',
  'rgba(255, 190, 90, 0.08)',
  'rgba(255, 190, 90, 0.12)',
  'rgba(255, 190, 90, 0.16)',
  'rgba(255, 190, 90, 0.19)',
  'rgba(255, 190, 90, 0.22)',
];

/** Small chip naming the safe shape while a shield slam is in the air. */
export function drawSafeRingHint(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, x: number, y: number,
): void {
  if (s.bossAttack !== 'shield1' && s.bossAttack !== 'shield2') return;
  const label = s.bossAttack === 'shield1' ? 'SAFE: 9×9 RING' : 'SAFE: 11×11 RING';
  const u = f.u;
  ctx.font = FONT_HUD_SM;
  const w = ctx.measureText(label).width + u * 0.8;
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x - w / 2, y, w, u * 0.9, u * 0.14);
  ctx.fill();
  ctx.strokeStyle = C.safeEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  outlinedText(ctx, label, x, y + u * 0.62, C.safeEdge, FONT_HUD_SM);
}

