/**
 * The actors on the Zuk platform: TzKal-Zuk, the Ancestral Glyph, the
 * adds, and the player.
 *
 * ## Original art
 * Zuk is a stylised volcanic colossus built from primitives — a crust
 * mass with glowing seams, a charging core slot, shoulder blocks and a
 * jagged crown. The adds are abstract shapes distinguished by silhouette
 * and hue, not by likeness. Nothing here reproduces or traces a game
 * model, sprite, texture, icon or font.
 *
 * ## Telegraphs
 * Every pose is a pure function of engine state — declare ticks, land
 * ticks and windup styles straight off `SimSnapshot`. The renderer never
 * decides what is coming or when.
 *
 * The reads the fight actually demands:
 *   Zuk's core brightens across his 3-tick charge → the shot is coming.
 *   Each add's ring is BLUE for magic and GREEN for ranged, with a tick
 *     countdown → which overhead you need, and when.
 *   The glyph is the one cold-coloured thing in the arena, and the
 *     columns it covers are the only safe ones.
 */
import { GLYPH_ROW, ZUK_ATTACK_DELAY } from '@sim/tzkalZuk/constants';
import type { EntityKind, EntitySnapshot, Overhead, SimSnapshot } from '@sim/tzkalZuk/types';
import type { FrameContext } from '../../arena/frame';
import { FONT_HUD_SM, FONT_SPLAT, HUD, drawMiniBar } from '../../arena/hud';
import { ISO_HH, ISO_HW, project, projectTile, type Camera, type Point } from '../../arena/projection';
import {
  areaPath, beginUpright, endUpright, groundEllipse, numStr, outlinedText, roundRectPath,
} from '../../arena/shapes';
import { C, type InfernoGradients } from './palette';

const PT: Point = { x: 0, y: 0 };
const PT2: Point = { x: 0, y: 0 };

type Frame = FrameContext & { grad: InfernoGradients };

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * Zuk's body unit. He occupies 7×7 tiles; at the player's scale he would
 * read as a pebble on a dinner plate.
 */
export const ZUK_UNIT = 2.4;

/** 0..1 progress through Zuk's charge, from engine ticks only. */
export function chargeProgress(s: SimSnapshot, t: number): number {
  if (s.zukWindupLandTick < 0) return 0;
  const start = s.zukWindupStartTick >= 0 ? s.zukWindupStartTick : s.zukWindupLandTick - ZUK_ATTACK_DELAY;
  const span = Math.max(1, s.zukWindupLandTick - start);
  return clamp01((t - start) / span);
}

/** Screen centre of Zuk's footprint. */
export function zukCentre(s: SimSnapshot, cam: Camera, out: Point): Point {
  return project(cam, s.zukAnchor.x + s.zukSize / 2, cam.gh - s.zukAnchor.y - s.zukSize / 2, out);
}

// -------------------------------------------------------------------- Zuk

export function drawZukFootprint(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  ctx.beginPath();
  areaPath(ctx, f.cam, s.zukAnchor.x, s.zukAnchor.y,
    s.zukAnchor.x + s.zukSize - 1, s.zukAnchor.y + s.zukSize - 1);
  ctx.fillStyle = s.enraged ? 'rgba(255, 90, 26, 0.18)' : 'rgba(0, 0, 0, 0.25)';
  ctx.fill();
  ctx.strokeStyle = s.enraged ? 'rgba(255, 90, 26, 0.6)' : C.rimGlow;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function drawZuk(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  const u = f.u * ZUK_UNIT;
  zukCentre(s, f.cam, PT);
  const bx = PT.x;
  const by = PT.y;
  const charge = chargeProgress(s, f.t);
  const charging = s.zukWindupLandTick >= 0;
  const enraged = s.enraged;

  const crust = enraged ? '#4a1d08' : C.zukCrust;
  const crustLit = enraged ? '#7a3010' : C.zukCrustLit;
  const seam = enraged ? C.zukEnrage : C.zukSeam;

  // Ground marks tilt with the camera; the body above them foreshortens.
  if (f.q.shadows) groundEllipse(ctx, bx, by + f.u * 0.2, f.u * 3.6, f.u * 1.8, C.zukShadow, f.flat);
  if (f.q.glows && f.grad.heat) {
    ctx.save();
    ctx.translate(bx, by);
    const pulse = f.animating ? 0.7 + Math.sin(f.now / (enraged ? 420 : 760)) * 0.3 : 0.8;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = f.grad.heat;
    ctx.beginPath();
    ctx.ellipse(0, 0, f.u * 6, f.u * 3 * f.flat, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const upright = beginUpright(ctx, by, f.up);
  const H = 3.4 * u;
  const baseY = by;
  const topY = baseY - H;
  const halfW = u * 1.55;
  const waistY = baseY - H * 0.46;
  const shoulderY = baseY - H * 0.66;

  // Lower mass: a broad volcanic mound, widest at the ground.
  ctx.beginPath();
  ctx.moveTo(bx - halfW, baseY);
  ctx.lineTo(bx + halfW, baseY);
  ctx.lineTo(bx + halfW * 0.62, waistY);
  ctx.lineTo(bx - halfW * 0.62, waistY);
  ctx.closePath();
  ctx.fillStyle = crust;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bx - halfW, baseY);
  ctx.lineTo(bx, baseY);
  ctx.lineTo(bx, waistY);
  ctx.lineTo(bx - halfW * 0.62, waistY);
  ctx.closePath();
  ctx.fillStyle = crustLit;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Torso: narrower than the mound, so he has a silhouette rather than a
  // taper. Shoulders jut back out above it.
  ctx.beginPath();
  ctx.moveTo(bx - halfW * 0.58, waistY);
  ctx.lineTo(bx + halfW * 0.58, waistY);
  ctx.lineTo(bx + halfW * 0.66, shoulderY);
  ctx.lineTo(bx - halfW * 0.66, shoulderY);
  ctx.closePath();
  ctx.fillStyle = crustLit;
  ctx.fill();

  // Shoulder blocks and the arm masses hanging off them.
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(bx + sgn * halfW * 0.6, shoulderY + u * 0.05);
    ctx.lineTo(bx + sgn * halfW * 1.18, shoulderY + u * 0.22);
    ctx.lineTo(bx + sgn * halfW * 1.06, waistY + u * 0.15);
    ctx.lineTo(bx + sgn * halfW * 0.58, waistY);
    ctx.closePath();
    ctx.fillStyle = crust;
    ctx.fill();
    ctx.strokeStyle = seam;
    ctx.lineWidth = Math.max(1, u * 0.045);
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Head block between the shoulders.
  ctx.beginPath();
  ctx.moveTo(bx - halfW * 0.44, shoulderY);
  ctx.lineTo(bx + halfW * 0.44, shoulderY);
  ctx.lineTo(bx + halfW * 0.36, topY);
  ctx.lineTo(bx - halfW * 0.36, topY);
  ctx.closePath();
  ctx.fillStyle = crust;
  ctx.fill();

  // Glowing seams across the mound.
  ctx.strokeStyle = seam;
  ctx.lineWidth = Math.max(1.2, u * 0.06);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const yy = baseY - H * (0.1 + i * 0.13);
    const spanW = halfW * (0.95 - i * 0.12);
    ctx.moveTo(bx - spanW, yy);
    ctx.lineTo(bx - spanW * 0.2, yy + u * 0.08);
    ctx.lineTo(bx + spanW * 0.9, yy - u * 0.05);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The core: a slot in the torso that brightens as the shot charges.
  // It is the tell, so it is the brightest thing on him — but it must not
  // swallow the silhouette, or he stops reading as a creature.
  const coreY = baseY - H * 0.56;
  const coreH = u * (0.34 + charge * 0.18);
  const coreW = u * (0.18 + charge * 0.1);
  if (f.q.glows && f.grad.charge && charging) {
    ctx.save();
    ctx.translate(bx, coreY);
    ctx.globalAlpha = 0.35 + charge * 0.6;
    ctx.fillStyle = f.grad.charge;
    ctx.beginPath();
    ctx.arc(0, 0, u * (1.1 + charge * 1.1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  roundRectPath(ctx, bx - coreW, coreY - coreH, coreW * 2, coreH * 2, coreW * 0.6);
  ctx.fillStyle = charging ? C.zukCoreHot : C.zukCore;
  ctx.globalAlpha = charging ? 0.6 + charge * 0.4 : 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = seam;
  ctx.lineWidth = Math.max(1, u * 0.06);
  ctx.stroke();

  // Jagged crown across the head block, tallest in the middle.
  ctx.beginPath();
  ctx.moveTo(bx - halfW * 0.4, topY);
  for (let i = 0; i < 5; i++) {
    const t0 = i / 4;
    const px = bx - halfW * 0.4 + halfW * 0.8 * t0;
    const centreBias = 1 - Math.abs(t0 - 0.5) * 1.2;
    const spike = u * (0.28 + centreBias * 0.42);
    ctx.lineTo(px + halfW * 0.1, topY - spike);
    ctx.lineTo(px + halfW * 0.2, topY);
  }
  ctx.closePath();
  ctx.fillStyle = crust;
  ctx.fill();
  ctx.strokeStyle = seam;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Eyes, on the head block above the core.
  ctx.fillStyle = charging ? C.zukCoreHot : C.zukCore;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(bx + sgn * halfW * 0.2, topY + (shoulderY - topY) * 0.45,
      u * 0.13, u * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  endUpright(ctx, upright);
}

// ------------------------------------------------------------------ glyph

/**
 * The Ancestral Glyph: a floating barrier bar spanning the columns it
 * protects, plus the shelter it casts south toward the player. The bar is
 * the object itself; the faint band below it is the volume it shields —
 * both are physically there in game, so neither is an assist. The hard
 * green tile highlight is (see `overlay.drawGlyphSafeTiles`).
 */
export function drawGlyph(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  const span = s.glyphSpan;
  const u = f.u;
  if (!span || s.glyphDestroyed) {
    if (s.glyphDestroyed) drawGlyphWreck(ctx, f, s);
    return;
  }

  const frac = s.glyphMaxHp > 0 ? Math.max(0, s.glyphHp / s.glyphMaxHp) : 0;

  // The sheltered volume: everything south of the bar, in its columns.
  ctx.beginPath();
  areaPath(ctx, f.cam, span.x0, 0, span.x1 - 1, span.row - 1);
  ctx.fillStyle = C.glyphBand;
  ctx.globalAlpha = 0.35 + frac * 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.glyphBandEdge;
  ctx.lineWidth = Math.max(1.2, u * 0.08);
  ctx.stroke();

  // The bar itself, standing on its row.
  ctx.beginPath();
  areaPath(ctx, f.cam, span.x0, span.row, span.x1 - 1, span.row);
  ctx.fillStyle = C.glyphDeep;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.glyph;
  ctx.lineWidth = Math.max(1.5, u * 0.1);
  ctx.stroke();

  // A raised pane so it reads as a wall, not a decal.
  projectTile(f.cam, span.x0, span.row, PT);
  projectTile(f.cam, span.x1 - 1, span.row, PT2);
  const paneH = u * 1.5;
  ctx.beginPath();
  ctx.moveTo(PT.x - ISO_HW * f.cam.scale, PT.y);
  ctx.lineTo(PT2.x + ISO_HW * f.cam.scale, PT2.y);
  ctx.lineTo(PT2.x + ISO_HW * f.cam.scale, PT2.y - paneH);
  ctx.lineTo(PT.x - ISO_HW * f.cam.scale, PT.y - paneH);
  ctx.closePath();
  const shimmer = f.animating ? 0.20 + Math.sin(f.now / 900) * 0.05 : 0.22;
  ctx.fillStyle = C.glyph;
  ctx.globalAlpha = shimmer * (0.4 + frac * 0.6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.glyphCore;
  ctx.lineWidth = Math.max(1, u * 0.06);
  ctx.stroke();

  // Rune ticks along the pane — and cracks as it takes damage.
  const midY = (PT.y + PT2.y) / 2 - paneH * 0.5;
  ctx.strokeStyle = C.glyphCore;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const n = span.x1 - span.x0;
  for (let i = 0; i <= n; i++) {
    const t0 = i / n;
    const x = PT.x - ISO_HW * f.cam.scale + (PT2.x + ISO_HW * f.cam.scale - (PT.x - ISO_HW * f.cam.scale)) * t0;
    const y = PT.y + (PT2.y - PT.y) * t0;
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - paneH);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (frac < 0.6) {
    ctx.strokeStyle = '#ffb14a';
    ctx.globalAlpha = (0.6 - frac) * 1.4;
    ctx.lineWidth = Math.max(1, u * 0.05);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const t0 = (i + 0.5) / 5;
      const x = PT.x + (PT2.x - PT.x) * t0;
      const y = PT.y + (PT2.y - PT.y) * t0;
      ctx.moveTo(x - u * 0.3, y - paneH * 0.15);
      ctx.lineTo(x + u * 0.1, y - paneH * 0.6);
      ctx.lineTo(x - u * 0.15, y - paneH * 0.9);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Integrity bar over the middle of the pane.
  const barW = u * 2.4;
  drawMiniBar(ctx, (PT.x + PT2.x) / 2 - barW / 2, midY - paneH * 0.9, barW,
    Math.max(2.5, u * 0.16), frac, frac > 0.35 ? C.glyph : '#ffb14a');

  // Patrol direction — which way to shuffle next.
  const arrowX = (PT.x + PT2.x) / 2 + s.glyphDir * (barW * 0.5 + u * 0.7);
  const ay = midY - paneH * 0.85;
  ctx.beginPath();
  ctx.moveTo(arrowX + s.glyphDir * u * 0.4, ay);
  ctx.lineTo(arrowX - s.glyphDir * u * 0.1, ay - u * 0.25);
  ctx.lineTo(arrowX - s.glyphDir * u * 0.1, ay + u * 0.25);
  ctx.closePath();
  ctx.fillStyle = C.glyphCore;
  ctx.fill();
}

/** Once the shield is gone the row is drawn as burnt-out stumps, so the
 *  arena never silently loses its most important object. */
function drawGlyphWreck(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  void s;
  const u = f.u;
  ctx.strokeStyle = C.glyphBroken;
  ctx.lineWidth = Math.max(1, u * 0.08);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let x = 0; x < f.cam.gw; x += 3) {
    projectTile(f.cam, x, GLYPH_ROW, PT);
    ctx.moveTo(PT.x, PT.y);
    ctx.lineTo(PT.x + u * 0.15, PT.y - u * 0.4);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------- adds

const ADD_COLOR: Record<EntityKind, string> = {
  zuk: C.zukCore, ranger: C.ranger, mager: C.mager, jad: C.jad, healer: C.healer, jadHealer: C.healer,
};
const ADD_DARK: Record<EntityKind, string> = {
  zuk: C.zukCrust, ranger: C.rangerDark, mager: C.magerDark, jad: C.jadDark, healer: C.healerDark, jadHealer: C.healerDark,
};
export const ADD_LABEL: Record<EntityKind, string> = {
  zuk: 'TzKal-Zuk', ranger: 'Jal-Xil', mager: 'Jal-Zek', jad: 'JalTok-Jad',
  healer: 'Jal-MejJak', jadHealer: 'Yt-HurKot',
};

/** Screen centre of an entity's footprint. */
export function entityCentre(e: EntitySnapshot, cam: Camera, out: Point): Point {
  return project(cam, e.pos.x + e.size / 2, cam.gh - e.pos.y - e.size / 2, out);
}

export function drawAdd(
  ctx: CanvasRenderingContext2D, f: Frame, e: EntitySnapshot,
  targeted: boolean, showTimer: boolean,
): void {
  const u = f.u * (0.7 + e.size * 0.35);
  entityCentre(e, f.cam, PT);
  const x = PT.x;
  const y = PT.y;
  const dead = !e.alive;
  const color = ADD_COLOR[e.kind];
  const dark = ADD_DARK[e.kind];

  ctx.save();
  if (dead) ctx.globalAlpha = 0.35;

  if (f.q.shadows) groundEllipse(ctx, x, y + u * 0.08, u * 0.85, u * 0.42, 'rgba(0,0,0,0.45)', f.flat);

  const upright = beginUpright(ctx, y, f.up);
  switch (e.kind) {
    case 'ranger': drawRanger(ctx, x, y, u, color, dark); break;
    case 'mager': drawMager(ctx, x, y, u, color, dark, f); break;
    case 'jad': drawJad(ctx, x, y, u, color, dark); break;
    case 'healer': case 'jadHealer': drawHealer(ctx, x, y, u, color, dark, f); break;
    default: break;
  }
  endUpright(ctx, upright);
  ctx.restore();

  // Health bar.
  const barW = u * 1.4;
  // Anchored above a body that shortens as the camera pitches over.
  const top = y - u * (e.kind === 'jad' ? 2.0 : 1.7) * f.up;
  drawMiniBar(ctx, x - barW / 2, top, barW, Math.max(2.5, u * 0.14),
    e.maxHp > 0 ? e.hp / e.maxHp : 0, dead ? '#6b6255' : color);

  // Aggression tell: an untagged spawn is eating the shield, not you.
  if (e.alive && (e.aggro === 'shield' || (e.kind === 'jadHealer' && !e.tagged))) {
    const label = e.aggro === 'shield' ? 'ON SHIELD' : 'HEALING';
    outlinedText(ctx, label, x, top - u * 0.3, '#ffb14a', FONT_HUD_SM);
  }

  // The prayer-switch tell: ring colour = style, number = ticks to land.
  if (e.windup && e.alive) {
    const ticks = Math.max(0, Math.ceil(e.windup.landTick - f.t));
    const styleColor = e.windup.style === 'magic' ? C.mager : e.windup.style === 'melee' ? C.zukCore : C.ranger;
    const imminent = ticks <= 1;
    ctx.strokeStyle = styleColor;
    ctx.lineWidth = Math.max(2, u * (imminent ? 0.22 : 0.13));
    ctx.globalAlpha = imminent ? 1 : 0.8;
    ctx.beginPath();
    ctx.ellipse(x, y, u * 1.05, u * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    outlinedText(ctx, numStr(ticks), x, y - u * 0.9 * f.up, styleColor, FONT_SPLAT);
  } else if (showTimer && e.alive && e.style && e.nextAttackTick > f.t) {
    // Assist: how long until it even starts winding up.
    outlinedText(ctx, numStr(Math.ceil(e.nextAttackTick - f.t)), x, y - u * 0.9 * f.up, HUD.dim, FONT_HUD_SM);
  }

  if (targeted) {
    ctx.strokeStyle = C.playerTrim;
    ctx.lineWidth = Math.max(1.5, u * 0.1);
    ctx.beginPath();
    ctx.ellipse(x, y + u * 0.05, u * 1.25, u * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Jal-Xil: lean, angular, drawn bow. */
function drawRanger(
  ctx: CanvasRenderingContext2D, x: number, y: number, u: number, color: string, dark: string,
): void {
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.45, y);
  ctx.lineTo(x + u * 0.45, y);
  ctx.lineTo(x + u * 0.3, y - u * 1.0);
  ctx.lineTo(x - u * 0.3, y - u * 1.0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.3, y - u * 1.0);
  ctx.lineTo(x + u * 0.3, y - u * 1.0);
  ctx.lineTo(x, y - u * 1.45);
  ctx.closePath();
  ctx.fill();
  // Bow arc.
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, u * 0.08);
  ctx.beginPath();
  ctx.arc(x + u * 0.55, y - u * 0.7, u * 0.45, -1.2, 1.2);
  ctx.stroke();
}

/** Jal-Zek: hunched, with a floating orb. */
function drawMager(
  ctx: CanvasRenderingContext2D, x: number, y: number, u: number,
  color: string, dark: string, f: Frame,
): void {
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.5, u * 0.5, u * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.45, y - u * 0.75);
  ctx.lineTo(x + u * 0.45, y - u * 0.75);
  ctx.lineTo(x, y - u * 1.4);
  ctx.closePath();
  ctx.fill();
  const bob = f.animating ? Math.sin(f.now / 520) * u * 0.08 : 0;
  ctx.beginPath();
  ctx.arc(x + u * 0.6, y - u * 0.95 + bob, u * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = C.glyphCore;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * JalTok-Jad: a heavy quadruped hunched over a wide maw. The raised
 * head-hump and the splayed legs are what separate it at a glance from
 * the blocky ranger and the round healers.
 */
function drawJad(
  ctx: CanvasRenderingContext2D, x: number, y: number, u: number, color: string, dark: string,
): void {
  // Legs first, so the body sits over them.
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(2, u * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const sgn of [-1, 1]) {
    ctx.moveTo(x + sgn * u * 0.55, y - u * 0.45);
    ctx.lineTo(x + sgn * u * 1.0, y - u * 0.05);
    ctx.moveTo(x + sgn * u * 0.3, y - u * 0.4);
    ctx.lineTo(x + sgn * u * 0.55, y + u * 0.05);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Bulk of the body: a low dome.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.62, u * 0.95, u * 0.5, 0, Math.PI, 0);
  ctx.lineTo(x - u * 0.95, y - u * 0.32);
  ctx.closePath();
  ctx.fill();

  // Head hump, offset forward (down-screen, toward the player).
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.95, u * 0.62, u * 0.42, 0, Math.PI, 0);
  ctx.lineTo(x - u * 0.62, y - u * 0.8);
  ctx.closePath();
  ctx.fill();

  // Maw: the wide slot the attacks come out of.
  ctx.fillStyle = '#2b1405';
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.72, u * 0.5, u * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.zukCore;
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.stroke();
  // Teeth.
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    const tx = x + i * u * 0.17;
    ctx.moveTo(tx, y - u * 0.79);
    ctx.lineTo(tx + u * 0.05, y - u * 0.66);
  }
  ctx.strokeStyle = C.zukCoreHot;
  ctx.lineWidth = Math.max(1, u * 0.04);
  ctx.stroke();

  // Ridge along the back.
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, u * 0.06);
  ctx.beginPath();
  ctx.moveTo(x - u * 0.85, y - u * 0.68);
  ctx.lineTo(x - u * 0.3, y - u * 1.05);
  ctx.lineTo(x + u * 0.3, y - u * 1.05);
  ctx.lineTo(x + u * 0.85, y - u * 0.68);
  ctx.stroke();
}

/** Jal-MejJak: a small drifting blob with tendrils. */
function drawHealer(
  ctx: CanvasRenderingContext2D, x: number, y: number, u: number,
  color: string, dark: string, f: Frame,
): void {
  const bob = f.animating ? Math.sin(f.now / 430 + x) * u * 0.1 : 0;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.5 + bob, u * 0.42, u * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - u * 0.58 + bob, u * 0.26, u * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, u * 0.06);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    ctx.moveTo(x + Math.cos(a) * u * 0.3, y - u * 0.35 + bob);
    ctx.lineTo(x + Math.cos(a) * u * 0.55, y - u * 0.02);
  }
  ctx.stroke();
}

/** Healer → Zuk beam: why his health bar is going the wrong way. */
export function drawHealBeam(
  ctx: CanvasRenderingContext2D, f: Frame, e: EntitySnapshot, s: SimSnapshot,
): void {
  entityCentre(e, f.cam, PT);
  const hx = PT.x;
  const hy = PT.y - f.u * 0.6;
  zukCentre(s, f.cam, PT2);
  ctx.save();
  ctx.strokeStyle = C.healer;
  ctx.globalAlpha = f.animating ? 0.35 + Math.sin(f.now / 200) * 0.2 : 0.45;
  ctx.lineWidth = Math.max(1.2, f.u * 0.08);
  ctx.setLineDash(HEAL_DASH);
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(PT2.x, PT2.y - f.u * 2);
  ctx.stroke();
  ctx.restore();
}

const HEAL_DASH = [5, 4];

// ----------------------------------------------------------------- player

export interface PlayerVisual {
  x: number;
  y: number;
  /** Screen-space facing, unit length. */
  fx: number;
  fy: number;
  /** 0..1 — bow-draw animation progress. */
  shoot: number;
}

const OVERHEAD_COLOR: Record<Overhead, string> = {
  melee: '#c8281e', ranged: C.ranger, magic: C.mager,
};

export function drawPlayer(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, pv: PlayerVisual,
): void {
  const u = f.u;
  projectTile(f.cam, pv.x, pv.y, PT);
  const px = PT.x;
  const py = PT.y;
  const alive = s.playerAlive;
  const H = 2.4 * u;

  // Exposure is the whole fight: when Zuk is charging and you are not
  // behind the glyph, the marker turns hot and gets a warning ring.
  const charging = s.zukWindupLandTick >= 0;
  const exposed = charging && !s.playerBehindGlyph && !s.glyphDestroyed;

  if (f.q.shadows) groundEllipse(ctx, px, py + u * 0.05, u * 0.52, u * 0.26, 'rgba(0,0,0,0.45)', f.flat);

  if (exposed) {
    const pulse = f.animating ? 0.55 + Math.sin(f.now / 130) * 0.35 : 0.7;
    ctx.strokeStyle = C.exposed;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = Math.max(2, u * 0.14);
    ctx.beginPath();
    ctx.ellipse(px, py + u * 0.05, u * 0.8, u * 0.4 * f.flat, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (s.runEnergy < 100 || s.playerRunning) {
    ctx.beginPath();
    ctx.ellipse(px, py + u * 0.05, u * 0.6, u * 0.3 * f.flat, 0, -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * (s.runEnergy / 100));
    ctx.strokeStyle = s.runEnergy < 25 ? '#e2571f' : C.playerTrim;
    ctx.lineWidth = Math.max(1.2, u * 0.09);
    ctx.stroke();
  }

  const upright = beginUpright(ctx, py, f.up);
  const bodyTop = py - H * 0.62;
  const headY = py - H * 0.82;

  ctx.fillStyle = alive ? C.playerCloak : C.playerDead;
  ctx.beginPath();
  ctx.moveTo(px - u * 0.34 - pv.fx * u * 0.16, bodyTop);
  ctx.lineTo(px + u * 0.34 - pv.fx * u * 0.16, bodyTop);
  ctx.lineTo(px + u * 0.28 - pv.fx * u * 0.30, py);
  ctx.lineTo(px - u * 0.28 - pv.fx * u * 0.30, py);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = !alive ? C.playerDead : exposed ? C.exposed : C.player;
  ctx.beginPath();
  ctx.moveTo(px - u * 0.26, bodyTop);
  ctx.lineTo(px + u * 0.26, bodyTop);
  ctx.lineTo(px + u * 0.20, py - u * 0.04);
  ctx.lineTo(px - u * 0.20, py - u * 0.04);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, headY, u * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.playerTrim;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Bow — this is a ranged fight, so the weapon glyph is always the bow.
  const ang = Math.atan2(pv.fy, pv.fx);
  const hx = px + pv.fx * u * 0.34;
  const hy = py - u * 0.95 + pv.fy * u * 0.14;
  ctx.strokeStyle = C.playerTrim;
  ctx.lineWidth = Math.max(1.4, u * 0.1);
  ctx.beginPath();
  ctx.arc(hx, hy, u * (0.42 + pv.shoot * 0.1), ang - 1.1, ang + 1.1);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx + Math.cos(ang - 1.1) * u * 0.42, hy + Math.sin(ang - 1.1) * u * 0.42);
  ctx.lineTo(hx + Math.cos(ang + 1.1) * u * 0.42, hy + Math.sin(ang + 1.1) * u * 0.42);
  ctx.stroke();

  drawMicroBars(ctx, s, px, headY - u * 1.02, u);
  drawOverheadGlyph(ctx, s.overhead, px, headY - u * 1.9, u);
  endUpright(ctx, upright);
}

/**
 * Overhead protection prayer. Original glyphs: a shield outline with a
 * mark that differs per style — a bar for melee, a chevron for missiles,
 * a spark for magic — so the active overhead is readable at a glance
 * without matching any in-game icon.
 */
function drawOverheadGlyph(
  ctx: CanvasRenderingContext2D, overhead: Overhead | null, x: number, y: number, u: number,
): void {
  if (!overhead) return;
  const size = u * 0.5;
  const tint = OVERHEAD_COLOR[overhead];
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y - size);
  ctx.lineTo(x + size, y + size * 0.15);
  ctx.quadraticCurveTo(x, y + size * 1.3, x - size, y + size * 0.15);
  ctx.closePath();
  ctx.fillStyle = '#14100c';
  ctx.fill();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  if (overhead === 'melee') {
    ctx.moveTo(x - size * 0.5, y + size * 0.4);
    ctx.lineTo(x + size * 0.5, y - size * 0.6);
  } else if (overhead === 'ranged') {
    ctx.moveTo(x - size * 0.5, y - size * 0.35);
    ctx.lineTo(x, y + size * 0.45);
    ctx.lineTo(x + size * 0.5, y - size * 0.35);
  } else {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      ctx.moveTo(x, y - size * 0.05);
      ctx.lineTo(x + Math.cos(a) * size * 0.55, y - size * 0.05 + Math.sin(a) * size * 0.55);
    }
  }
  ctx.stroke();
}

function drawMicroBars(
  ctx: CanvasRenderingContext2D, s: SimSnapshot, x: number, y: number, u: number,
): void {
  const w = u * 1.5;
  const h = Math.max(2.5, u * 0.16);
  const hpFrac = s.playerMaxHp > 0 ? Math.max(0, s.playerHp / s.playerMaxHp) : 0;
  const prFrac = s.playerMaxPrayer > 0 ? Math.max(0, s.playerPrayer / s.playerMaxPrayer) : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h * 2 + 3);
  ctx.fillStyle = hpFrac > 0.35 ? '#3fbf5f' : '#c8281e';
  ctx.fillRect(x - w / 2, y, w * hpFrac, h);
  ctx.fillStyle = '#6fd6d6';
  ctx.fillRect(x - w / 2, y + h + 1, w * prFrac, h);
}

/** Pixel height of one tile step, for stacking overhead UI. */
export function tileStepY(cam: Camera): number {
  return ISO_HH * cam.scale * 2;
}
