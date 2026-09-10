/**
 * Drawing for the shared effect pools. Every arena spawns the same
 * vocabulary — hitsplats, floating text, ground rings, weapon arcs,
 * bursts, slams and beam flashes — so the draw side lives here and the
 * per-fight packages only decide *when* to spawn what.
 *
 * OSRS-style splat colouring (red normal, blue miss, orange typeless,
 * purple prayer drain) on an original rounded-diamond shape. No game
 * sprite is reproduced.
 */
import type { FrameContext } from './frame';
import { FxColor, FxKind, easeOut, fxProgress, type Fx, type FxPool, type ParticleField } from './effects';
import { FONT_SPLAT } from './hud';
import { projectTile, type Point } from './projection';
import { outlinedText } from './shapes';

const PT: Point = { x: 0, y: 0 };

export const FX_FILL: Record<FxColor, string> = {
  [FxColor.Damage]: '#c8281e',
  [FxColor.Miss]: '#3a6fd8',
  [FxColor.Typeless]: '#e2571f',
  [FxColor.Prayer]: '#9b5de5',
  [FxColor.Heal]: '#3fbf5f',
  [FxColor.Spec]: '#d4af37',
  [FxColor.Gold]: '#f2c94c',
  [FxColor.Danger]: '#e2402a',
  [FxColor.Safe]: '#3fbf5f',
};

export const FX_INK: Record<FxColor, string> = {
  [FxColor.Damage]: '#ffffff',
  [FxColor.Miss]: '#ffffff',
  [FxColor.Typeless]: '#2b1405',
  [FxColor.Prayer]: '#ffffff',
  [FxColor.Heal]: '#0d2812',
  [FxColor.Spec]: '#2b2419',
  [FxColor.Gold]: '#2b2419',
  [FxColor.Danger]: '#ffffff',
  [FxColor.Safe]: '#0d2812',
};

export function drawEffects(
  ctx: CanvasRenderingContext2D, f: FrameContext, pool: FxPool, particles: ParticleField,
): void {
  const items = pool.items;
  for (let i = 0; i < items.length; i++) {
    const fx = items[i];
    if (!fx.active) continue;
    const p = fxProgress(fx, f.animating);
    switch (fx.kind) {
      case FxKind.Hitsplat: drawHitsplat(ctx, f, fx, p); break;
      case FxKind.Text: drawFloatText(ctx, f, fx, p); break;
      case FxKind.Ring: drawRing(ctx, f, fx, p); break;
      case FxKind.Swing: drawSwing(ctx, f, fx, p); break;
      case FxKind.Burst: drawBurst(ctx, f, fx, p); break;
      case FxKind.Slam: drawSlam(ctx, f, fx, p); break;
      case FxKind.Beam: drawBeamFlash(ctx, f, fx, p); break;
      default: break;
    }
  }
  if (f.q.maxParticles > 0) drawParticles(ctx, f, particles);
}

function drawHitsplat(ctx: CanvasRenderingContext2D, f: FrameContext, fx: Fx, p: number): void {
  const u = f.u;
  projectTile(f.cam, fx.a, fx.b, PT);
  const rise = easeOut(p) * u * 1.15;
  const x = PT.x + fx.dx * u;
  const y = PT.y - u * 1.4 - rise + fx.dy * u;
  const alpha = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;
  const w = u * (fx.text.length > 2 ? 0.98 : 0.82);
  const h = u * 0.62;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y);
  ctx.quadraticCurveTo(x + w / 2, y + h / 2, x, y + h / 2);
  ctx.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y);
  ctx.quadraticCurveTo(x - w / 2, y - h / 2, x, y - h / 2);
  ctx.closePath();
  ctx.fillStyle = FX_FILL[fx.color as FxColor];
  ctx.fill();
  if (fx.value2 === 1) { // emphasised hit (spec / crit) — gold rim
    ctx.strokeStyle = '#f2c94c';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.font = FONT_SPLAT;
  ctx.textAlign = 'center';
  ctx.fillStyle = FX_INK[fx.color as FxColor];
  ctx.fillText(fx.text, x, y + u * 0.16);
  ctx.restore();
}

function drawFloatText(ctx: CanvasRenderingContext2D, f: FrameContext, fx: Fx, p: number): void {
  const u = f.u;
  projectTile(f.cam, fx.a, fx.b, PT);
  const y = PT.y - u * 2.0 - easeOut(p) * u * 1.5;
  ctx.save();
  ctx.globalAlpha = p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1;
  outlinedText(ctx, fx.text, PT.x + fx.dx * u, y, FX_FILL[fx.color as FxColor], FONT_SPLAT);
  ctx.restore();
}

/** Expanding ground ring — slams, shockwaves, spawn markers. */
function drawRing(ctx: CanvasRenderingContext2D, f: FrameContext, fx: Fx, p: number): void {
  const u = f.u;
  projectTile(f.cam, fx.a, fx.b, PT);
  const r = (fx.value + (fx.value2 - fx.value) * easeOut(p)) * u * 2;
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.85;
  ctx.strokeStyle = FX_FILL[fx.color as FxColor];
  ctx.lineWidth = Math.max(1.5, u * 0.14 * (1 - p * 0.5));
  ctx.beginPath();
  ctx.ellipse(PT.x, PT.y, r, r * (f.cam.mode === 'tactical' ? 1 : 0.5 * f.flat), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Weapon arc / projectile streak, oriented along the effect's direction. */
function drawSwing(ctx: CanvasRenderingContext2D, f: FrameContext, fx: Fx, p: number): void {
  const u = f.u;
  projectTile(f.cam, fx.a, fx.b, PT);
  const ang = Math.atan2(fx.dy, fx.dx);
  const sweep = 1.5;
  const start = ang - sweep / 2 + sweep * p * 0.6;
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.8;
  ctx.strokeStyle = FX_FILL[fx.color as FxColor];
  ctx.lineWidth = Math.max(1.5, u * 0.18 * (1 - p));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(PT.x, PT.y - u * 0.9, u * (0.7 + fx.value), u * (0.45 + fx.value * 0.6),
    0, start, start + sweep);
  ctx.stroke();
  ctx.restore();
}

/** Radial spokes — parries, blocks, activations. */
function drawBurst(ctx: CanvasRenderingContext2D, f: FrameContext, fx: Fx, p: number): void {
  const u = f.u;
  projectTile(f.cam, fx.a, fx.b, PT);
  const r = u * (0.4 + easeOut(p) * (1.6 + fx.value));
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.9;
  ctx.strokeStyle = FX_FILL[fx.color as FxColor];
  ctx.lineWidth = Math.max(1.2, u * 0.1);
  ctx.beginPath();
  const spokes = 8;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a) * 0.55;
    ctx.moveTo(PT.x + cx * r * 0.45, PT.y - u * 0.7 + cy * r * 0.45);
    ctx.lineTo(PT.x + cx * r, PT.y - u * 0.7 + cy * r);
  }
  ctx.stroke();
  ctx.restore();
}

/** Ground impact: a flattened shock ellipse plus a dust rim. */
function drawSlam(ctx: CanvasRenderingContext2D, f: FrameContext, fx: Fx, p: number): void {
  const u = f.u;
  projectTile(f.cam, fx.a, fx.b, PT);
  const r = u * (0.5 + easeOut(p) * (2.4 + fx.value));
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.55;
  ctx.fillStyle = 'rgba(180, 96, 40, 0.35)';
  ctx.beginPath();
  ctx.ellipse(PT.x, PT.y, r, r * (f.cam.mode === 'tactical' ? 1 : 0.5 * f.flat), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = (1 - p) * 0.9;
  ctx.strokeStyle = FX_FILL[fx.color as FxColor];
  ctx.lineWidth = Math.max(1.5, u * 0.12);
  ctx.stroke();
  ctx.restore();
}

/** A vertical column of light — beams, launches, pillars of fire. */
function drawBeamFlash(ctx: CanvasRenderingContext2D, f: FrameContext, fx: Fx, p: number): void {
  const u = f.u;
  projectTile(f.cam, fx.a, fx.b, PT);
  const h = u * 9 * (1 - p * 0.35);
  ctx.save();
  ctx.globalAlpha = 1 - p;
  ctx.fillStyle = '#fff6d8';
  const w = u * 0.34 * (1 - p * 0.6);
  ctx.fillRect(PT.x - w, PT.y - h, w * 2, h);
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, f: FrameContext, pf: ParticleField): void {
  const u = f.u;
  for (let i = 0; i < pf.count; i++) {
    if (!pf.isAlive(i)) continue;
    const p = pf.age[i] / pf.life[i];
    projectTile(f.cam, pf.a[i], pf.b[i], PT);
    ctx.globalAlpha = (1 - p) * 0.8;
    ctx.fillStyle = FX_FILL[pf.color[i] as FxColor];
    const r = pf.size[i] * u * (1 - p * 0.5);
    ctx.beginPath();
    ctx.arc(PT.x, PT.y - pf.z[i], r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
