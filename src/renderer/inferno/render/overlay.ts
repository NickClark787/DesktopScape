/**
 * Ground overlays for the Zuk platform: the glyph's protected columns,
 * the exposure lane, click markers and the set countdown.
 *
 * Everything positional comes straight from `SimSnapshot` — the glyph
 * span the engine will test `protects()` against, the charge ticks it
 * will resolve on. The renderer derives no geometry of its own, so what
 * is drawn and what saves you cannot drift apart.
 */
import type { SimSnapshot } from '@sim/tzkalZuk/types';
import type { FrameContext } from '../../arena/frame';
import { FONT_HUD_SM, FONT_LABEL, HUD } from '../../arena/hud';
import { projectTile, type Point } from '../../arena/projection';
import { areaPath, numStr, outlinedText, roundRectPath, tilePath } from '../../arena/shapes';
import { C, type InfernoGradients } from './palette';
import { chargeProgress, zukCentre } from './actors';

type Frame = FrameContext & { grad: InfernoGradients };

const PT: Point = { x: 0, y: 0 };
const PT2: Point = { x: 0, y: 0 };
const DASH = [4, 3];
/** Pre-built so the marker pass stays allocation-free. */
const LAG_LABELS = ['+0t', '+1t', '+2t', '+3t', '+4t', '+5t', '+6t', '+7t', '+8t', '+9t', '+9t+'];

/**
 * The tiles the glyph currently shelters, written into `out` as x/y pairs
 * and returning the count.
 *
 * This is the ONE piece of geometry the renderer walks itself, so it is
 * unit-tested tile-for-tile against the engine's own `spanProtects` —
 * drawing a safe tile the engine would call exposed is the worst lie this
 * layer could tell.
 */
export function glyphSafeTiles(
  span: { x0: number; x1: number; row: number }, xs: Int16Array, ys: Int16Array,
): number {
  let n = 0;
  for (let x = span.x0; x < span.x1; x++) {
    for (let y = 0; y < span.row; y++) {
      if (n >= xs.length) return n;
      xs[n] = x;
      ys[n] = y;
      n++;
    }
  }
  return n;
}

/**
 * Assist: a hard green wash on exactly those tiles. The glyph and the
 * volume it shelters are drawn regardless (they are physically there);
 * this spells out the tile boundary, so it is gated and flagged.
 */
export function drawGlyphSafeTiles(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, xs: Int16Array, ys: Int16Array,
): void {
  const span = s.glyphSpan;
  if (!span || s.glyphDestroyed) return;
  const n = glyphSafeTiles(span, xs, ys);
  ctx.beginPath();
  for (let i = 0; i < n; i++) tilePath(ctx, f.cam, xs[i], ys[i], 0.1);
  ctx.fillStyle = C.safe;
  ctx.fill();
  ctx.strokeStyle = C.safeEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * The shot in flight. Zuk's attack cannot be prayed or eaten through —
 * the only defence is the glyph — so when he is charging and the player
 * is NOT sheltered, the lane between them lights up and brightens as the
 * landing tick approaches. That is the death cascade made visible.
 */
export function drawExposureLane(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, px: number, py: number): void {
  if (s.zukWindupLandTick < 0) return;
  if (s.playerBehindGlyph) return;
  const p = chargeProgress(s, f.t);
  zukCentre(s, f.cam, PT2);
  projectTile(f.cam, px, py, PT);

  ctx.save();
  ctx.globalAlpha = 0.25 + p * 0.55;
  ctx.strokeStyle = C.exposed;
  ctx.lineWidth = Math.max(2, f.u * (0.14 + p * 0.2));
  ctx.setLineDash(DASH);
  ctx.lineDashOffset = f.animating ? -(f.now / 24) % 100 : 0;
  ctx.beginPath();
  ctx.moveTo(PT2.x, PT2.y - f.u * 2.4);
  ctx.lineTo(PT.x, PT.y - f.u * 0.6);
  ctx.stroke();
  ctx.restore();

  // Impact marker on the player's tile.
  ctx.beginPath();
  tilePath(ctx, f.cam, Math.round(px), Math.round(py), 0.06);
  ctx.fillStyle = C.danger;
  ctx.globalAlpha = 0.35 + p * 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.dangerEdge;
  ctx.lineWidth = Math.max(1.5, f.u * 0.1);
  ctx.stroke();
}

/**
 * Zuk's charge readout, over his crown: the ticks until his shot lands
 * and whether you are currently sheltered. The count mirrors the core
 * animation rather than adding information — you can read the same thing
 * off the glow — so it is on by default.
 */
export function drawZukCharge(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, x: number, y: number): void {
  if (s.zukWindupLandTick < 0) return;
  const ticks = Math.max(0, Math.ceil(s.zukWindupLandTick - f.t));
  const sheltered = s.playerBehindGlyph;
  const tint = sheltered ? C.glyph : C.exposed;
  const label = sheltered ? 'SHELTERED' : 'EXPOSED';
  const u = f.u;

  ctx.font = FONT_LABEL;
  const w = Math.max(u * 5.6, ctx.measureText(label).width + u * 2);
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x - w / 2, y - u * 1.5, w, u * 1.7, u * 0.2);
  ctx.fill();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  outlinedText(ctx, label, x, y - u * 0.75, tint, FONT_LABEL);

  // One pip per remaining tick of the charge.
  const total = Math.max(1, s.zukWindupLandTick - s.zukWindupStartTick);
  const pipR = Math.max(2.5, u * 0.17);
  const gap = pipR * 3;
  const startX = x - (gap * (total - 1)) / 2;
  for (let i = 0; i < total; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * gap, y - u * 0.2, pipR, 0, Math.PI * 2);
    ctx.fillStyle = i < ticks ? tint : 'rgba(255,255,255,0.16)';
    ctx.fill();
  }
}

/** Click marker plus the in-flight ghost — the visible face of ping. */
export function drawMarkers(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, showLatency: boolean,
): void {
  const u = f.u;
  if (s.playerMoveTarget) {
    projectTile(f.cam, s.playerMoveTarget.x, s.playerMoveTarget.y, PT);
    ctx.strokeStyle = C.clickMarker;
    ctx.lineWidth = Math.max(1.5, u * 0.1);
    const r = u * 0.3;
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

/** Assist: ticks until the next Jal-Xil / Jal-Zek set drops. */
export function drawSetCountdown(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, w: number): void {
  if (s.setCountdown < 0) return;
  const label = SET_LABEL_PREFIX + numStr(s.setCountdown) + 't';
  ctx.font = FONT_HUD_SM;
  const bw = ctx.measureText(label).width + 18;
  const x = w / 2 - bw / 2;
  const y = s.enraged ? 58 : 46;
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x, y, bw, 18, 4);
  ctx.fill();
  ctx.strokeStyle = s.setCountdown < 20 ? C.dangerEdge : HUD.edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  outlinedText(ctx, label, w / 2, y + 13, s.setCountdown < 20 ? C.dangerEdge : HUD.dim, FONT_HUD_SM);
  void f;
}

const SET_LABEL_PREFIX = 'next set ';

/** Full-canvas heat wash while enraged. Low alpha, slow — a readable
 *  state change, not a strobe. */
export function drawEnrageWash(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, w: number, h: number,
): void {
  if (!s.enraged) return;
  const step = f.animating
    ? Math.min(WASH_STEPS.length - 1, Math.max(0, Math.round(2 + Math.sin(f.now / 700) * 2)))
    : 2;
  ctx.fillStyle = WASH_STEPS[step];
  ctx.fillRect(0, 0, w, h);
}

// Pre-built: building `rgba(...)` here would allocate per frame.
const WASH_STEPS = [
  'rgba(255, 90, 26, 0.03)',
  'rgba(255, 90, 26, 0.05)',
  'rgba(255, 90, 26, 0.07)',
  'rgba(255, 90, 26, 0.09)',
  'rgba(255, 90, 26, 0.11)',
];

/** The glyph row, marked across the whole arena when the shield is gone —
 *  so "there is nowhere safe now" is unmistakable. */
export function drawGlyphGoneWarning(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  if (!s.glyphDestroyed) return;
  ctx.beginPath();
  areaPath(ctx, f.cam, 0, 0, f.cam.gw - 1, f.cam.gh - 1);
  ctx.fillStyle = 'rgba(255, 90, 26, 0.07)';
  ctx.fill();
}
