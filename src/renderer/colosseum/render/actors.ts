/**
 * The two actors: Sol and the player.
 *
 * ## Original art
 * Sol is drawn as a stylised heavy-armoured gladiator assembled from
 * primitives — a plated torso hexagon, a sun emblem of eight triangular
 * rays, pauldron arcs, a crested helm, a tower shield and a spear. It is
 * an original silhouette that conveys mass, facing and weapon state; no
 * game model, sprite, texture or icon is reproduced or traced. The same
 * goes for the player marker and the prayer glyphs.
 *
 * ## Telegraphs
 * Every pose is a pure function of engine state: the declare tick, the
 * resolve tick and the facing the engine froze when it committed the
 * hazard. The renderer never decides *what* is coming or *when* — it only
 * decides how to draw what the snapshot already says.
 *
 * The four wind-ups are deliberately different silhouettes, because that
 * is the skill being taught:
 *   Spear 1 — weapon raised high and level, arms overhead → wide sweep.
 *   Spear 2 — weapon drawn back at the hip, body coiled → straight thrust.
 *   Shield 1 — shield lifted chest-high, short ground ring.
 *   Shield 2 — shield lifted overhead two-handed, wide ground ring.
 */
import { ARENA_H, BOSS_SIZE } from '@sim/solHeredit/constants';
import type { BossAttack, GrappleSlot, SimSnapshot } from '@sim/solHeredit/types';
import type { FrameContext } from '../../arena/frame';
import { FONT_HUD_SM, FONT_LABEL, HUD } from '../../arena/hud';
import { ISO_HH, TAC_TILE, project, projectTile, type Camera, type Point } from '../../arena/projection';
import {
  areaPath, beginUpright, endUpright, groundEllipse, outlinedText, roundRectPath,
} from '../../arena/shapes';
import { C, type ColosseumGradients } from './palette';

const PT: Point = { x: 0, y: 0 };
const DIR: Point = { x: 0, y: 0 };

/** The Colosseum frame carries its own gradient set. */
type Frame = FrameContext & { grad: ColosseumGradients };

/** Screen-space unit vector for a tile-space cardinal facing. */
export function facingScreenDir(cam: Camera, fx: number, fy: number, out: Point): Point {
  const da = fx;
  const db = -fy;
  // Straight through the camera basis, so "north" means whatever north
  // looks like at the current yaw rather than a baked-in up-and-left.
  out.x = da * cam.m11 + db * cam.m21;
  out.y = da * cam.m12 + db * cam.m22;
  const len = Math.hypot(out.x, out.y) || 1;
  out.x /= len;
  out.y /= len;
  return out;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** 0..1 progress through the current wind-up, from engine ticks only. */
export function windupProgress(s: SimSnapshot, t: number): number {
  if (!s.bossAttack || s.bossAttackDeclareTick < 0 || s.bossAttackResolveTick < 0) return 0;
  const span = s.bossAttackResolveTick - s.bossAttackDeclareTick;
  if (span <= 0) return 1;
  return clamp01((t - s.bossAttackDeclareTick) / span);
}

// ------------------------------------------------------------------- boss

/** Grid-space centre of the boss's 5×5 footprint. */
export function bossCentreGrid(s: SimSnapshot, out: Point): Point {
  out.x = s.bossAnchor.x + BOSS_SIZE / 2;
  out.y = ARENA_H - s.bossAnchor.y - BOSS_SIZE / 2;
  return out;
}

export function drawBossFootprint(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  const a = s.bossAnchor;
  ctx.beginPath();
  areaPath(ctx, f.cam, a.x, a.y, a.x + BOSS_SIZE - 1, a.y + BOSS_SIZE - 1);
  ctx.fillStyle = s.enraged ? 'rgba(226, 87, 31, 0.16)' : 'rgba(0, 0, 0, 0.22)';
  ctx.fill();
  ctx.strokeStyle = s.enraged ? 'rgba(226, 87, 31, 0.55)' : 'rgba(212, 175, 55, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Facing wedge: where his front is, on the ground, unmistakably.
  const c = bossCentreGrid(s, PT);
  const cx = c.x;
  const cy = c.y;
  project(f.cam, cx, cy, PT);
  const ox = PT.x;
  const oy = PT.y;
  facingScreenDir(f.cam, s.bossFacing.x, s.bossFacing.y, DIR);
  const reach = f.u * 5.2;
  const spread = 0.42;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(
    ox + (DIR.x * Math.cos(spread) - DIR.y * Math.sin(spread)) * reach,
    oy + (DIR.x * Math.sin(spread) + DIR.y * Math.cos(spread)) * reach * 0.5 * f.flat,
  );
  ctx.lineTo(
    ox + (DIR.x * Math.cos(-spread) - DIR.y * Math.sin(-spread)) * reach,
    oy + (DIR.x * Math.sin(-spread) + DIR.y * Math.cos(-spread)) * reach * 0.5 * f.flat,
  );
  ctx.closePath();
  ctx.fillStyle = 'rgba(212, 175, 55, 0.13)';
  ctx.fill();
}

/**
 * Sol's body unit. He occupies 5×5 tiles, so drawing him at the player's
 * scale makes a 1×1 marker of a boss that should dominate the arena; the
 * multiplier restores the mass without covering the tiles behind him.
 */
export const BOSS_UNIT = 1.75;

export function drawBoss(ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot): void {
  const u = f.u * BOSS_UNIT;
  const c = bossCentreGrid(s, PT);
  project(f.cam, c.x, c.y, PT);
  const bx = PT.x;
  const by = PT.y;
  const attack = s.bossAttack;
  const p = windupProgress(s, f.t);
  facingScreenDir(f.cam, s.bossFacing.x, s.bossFacing.y, DIR);

  const enraged = s.enraged;
  const plate = enraged ? C.bossEnrageDeep : C.bossPlate;
  const plateLit = enraged ? C.bossEnrage : C.bossPlateLit;
  const plateDark = enraged ? '#4a1204' : C.bossPlateDark;
  const trim = enraged ? '#ffb14a' : C.bossTrim;

  // Idle breathing — small, slow, and switched off when frozen.
  const breathe = f.animating ? Math.sin(f.now / 900) * 0.035 * u : 0;

  // Pose offsets driven purely by the declared attack.
  let crouch = 0;
  let lean = 0;
  if (attack === 'shield1') crouch = p * 0.18 * u;
  else if (attack === 'shield2') crouch = p * 0.30 * u;
  else if (attack === 'spear2') lean = -p * 0.35 * u;
  else if (attack === 'spear1') lean = p * 0.10 * u;
  else if (attack === 'tripleParry') crouch = 0.08 * u;

  const footY = by + crouch;
  const originX = bx + DIR.x * lean;
  const originY = footY + DIR.y * lean * 0.5 + breathe;

  // Ground contact is measured in TILE units (f.u), not body units, so the
  // shadow and the enrage pool stay inside his 5×5 footprint. Both lie on
  // the floor, so they open up as the camera pitches over rather than
  // shortening with him.
  if (f.q.shadows) {
    groundEllipse(ctx, bx, by + f.u * 0.18, f.u * 2.6, f.u * 1.25, C.bossShadow, f.flat);
  }
  if (enraged && f.q.glows && f.grad.enrage) {
    ctx.save();
    ctx.translate(bx, by);
    const pulse = f.animating ? 0.75 + Math.sin(f.now / 620) * 0.25 : 0.85;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = f.grad.enrage;
    ctx.beginPath();
    ctx.ellipse(0, 0, f.u * 4.6, f.u * 2.3 * f.flat, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Everything from here up is upright art: foreshorten it about his feet.
  const upright = beginUpright(ctx, footY, f.up);

  const H = 4.6 * u;         // total height
  const hipY = originY - H * 0.34;
  const chestY = originY - H * 0.62;
  const shoulderY = originY - H * 0.72;
  const headY = originY - H * 0.86;
  const halfW = u * 0.95;

  // Legs: two tapered greaves, lit enough to separate from the shadow.
  for (const sgn of [-1, 1]) {
    ctx.fillStyle = sgn < 0 ? plate : plateDark;
    ctx.beginPath();
    ctx.moveTo(originX + sgn * halfW * 0.24, hipY);
    ctx.lineTo(originX + sgn * halfW * 0.92, hipY);
    ctx.lineTo(originX + sgn * halfW * 0.84, originY);
    ctx.lineTo(originX + sgn * halfW * 0.16, originY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = plateDark;
    ctx.lineWidth = Math.max(1, u * 0.05);
    ctx.stroke();
  }
  // Sandals / greave trim.
  ctx.strokeStyle = trim;
  ctx.lineWidth = Math.max(1, u * 0.06);
  ctx.beginPath();
  ctx.moveTo(originX - halfW * 0.85, originY - u * 0.12);
  ctx.lineTo(originX - halfW * 0.18, originY - u * 0.12);
  ctx.moveTo(originX + halfW * 0.18, originY - u * 0.12);
  ctx.lineTo(originX + halfW * 0.85, originY - u * 0.12);
  ctx.stroke();

  // Waist skirt (pteruges): a fan of straps.
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.moveTo(originX - halfW, hipY - u * 0.28);
  ctx.lineTo(originX + halfW, hipY - u * 0.28);
  ctx.lineTo(originX + halfW * 0.92, hipY + u * 0.22);
  ctx.lineTo(originX - halfW * 0.92, hipY + u * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = plateDark;
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    const sx = originX + i * halfW * 0.38;
    ctx.moveTo(sx, hipY - u * 0.2);
    ctx.lineTo(sx, hipY + u * 0.2);
  }
  ctx.stroke();

  // Cuirass: a broad hexagon, lit on the facing side.
  ctx.beginPath();
  ctx.moveTo(originX - halfW * 1.18, shoulderY + u * 0.12);
  ctx.lineTo(originX, shoulderY - u * 0.10);
  ctx.lineTo(originX + halfW * 1.18, shoulderY + u * 0.12);
  ctx.lineTo(originX + halfW * 0.98, hipY - u * 0.18);
  ctx.lineTo(originX - halfW * 0.98, hipY - u * 0.18);
  ctx.closePath();
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(originX, shoulderY - u * 0.10);
  ctx.lineTo(originX + halfW * 1.18, shoulderY + u * 0.12);
  ctx.lineTo(originX + halfW * 0.98, hipY - u * 0.18);
  ctx.lineTo(originX, hipY - u * 0.18);
  ctx.closePath();
  ctx.fillStyle = plateLit;
  ctx.globalAlpha = 0.45;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Sun emblem — the original motif standing in for his heraldry.
  drawSunEmblem(ctx, originX, chestY, u * 0.52, trim, plateDark, enraged);

  // Pauldrons.
  ctx.fillStyle = plateLit;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(originX + sgn * halfW * 1.16, shoulderY + u * 0.10, u * 0.44, u * 0.30, 0, Math.PI, 0);
    ctx.fill();
  }

  // Helm: dome, visor slit, cheek guards, swept crest.
  ctx.beginPath();
  ctx.arc(originX, headY, u * 0.46, Math.PI, 0);
  ctx.lineTo(originX + u * 0.42, headY + u * 0.40);
  ctx.lineTo(originX - u * 0.42, headY + u * 0.40);
  ctx.closePath();
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.fillStyle = '#120c06';
  ctx.fillRect(originX - u * 0.30, headY - u * 0.02, u * 0.60, u * 0.13);
  ctx.fillRect(originX - u * 0.05, headY - u * 0.02, u * 0.10, u * 0.36);
  // Crest.
  ctx.beginPath();
  ctx.moveTo(originX - u * 0.10, headY - u * 0.44);
  ctx.quadraticCurveTo(originX + u * 0.05, headY - u * 1.02, originX - DIR.x * u * 0.75, headY - u * 0.84);
  ctx.quadraticCurveTo(originX - u * 0.10, headY - u * 0.78, originX + u * 0.10, headY - u * 0.42);
  ctx.closePath();
  ctx.fillStyle = enraged ? C.bossEnrage : C.bossCrest;
  ctx.fill();
  ctx.strokeStyle = enraged ? '#ffb14a' : C.bossCrestLit;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Weapons — the readable half of the telegraph.
  drawShield(ctx, f, s, originX, originY, u, attack, p, plate, plateLit, trim);
  drawSpear(ctx, f, s, originX, originY, u, attack, p, trim, enraged);
  endUpright(ctx, upright);
}

function drawSunEmblem(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
  gold: string, dark: string, enraged: boolean,
): void {
  // Eight triangular rays: a tip on the outer radius, two feet on the
  // inner one, splayed either side of the ray's own angle.
  const HALF = 0.20;
  ctx.fillStyle = gold;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    ctx.moveTo(x + Math.cos(ang) * r * 1.85, y + Math.sin(ang) * r * 1.85 * 0.72);
    ctx.lineTo(x + Math.cos(ang - HALF) * r * 0.9, y + Math.sin(ang - HALF) * r * 0.9 * 0.72);
    ctx.lineTo(x + Math.cos(ang + HALF) * r * 0.9, y + Math.sin(ang + HALF) * r * 0.9 * 0.72);
    ctx.closePath();
  }
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = enraged ? '#ffdca0' : gold;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawShield(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot,
  x: number, y: number, u: number, attack: BossAttack | null, p: number,
  plate: string, plateLit: string, trim: string,
): void {
  // The body is a screen-upright billboard, so the arms are placed in
  // SCREEN space — shield on the left, spear on the right. Facing changes
  // the ground wedge and the weapon's aim, not which side the arms are on.
  // Offsetting by the ground-plane side vector instead would slide the
  // shield across his chest and bury the emblem.
  const grappling = attack === 'grapple';
  let sx = x - u * 1.35;
  let sy = y - u * 2.45;
  let w = u * 1.5;
  let h = u * 2.0;
  let tilt = 0;

  if (grappling) {
    // Shield on the sand: the tell that a grab is coming.
    sx = x - u * 2.2;
    sy = y - u * 0.18;
    h = u * 0.8;
    tilt = 0.5;
  } else if (attack === 'shield1') {
    sy -= p * u * 0.9;
    sx += DIR.x * p * u * 0.4;
  } else if (attack === 'shield2') {
    // Two-handed and overhead: a visibly bigger commitment than shield 1.
    sy -= p * u * 1.75;
    sx = x - u * 1.35 * (1 - p) - u * 0.1 * p + DIR.x * p * u * 0.2;
    w = u * 1.85;
    h = u * 2.35;
  }

  ctx.save();
  ctx.translate(sx, sy);
  if (tilt) ctx.rotate(tilt);
  ctx.beginPath();
  roundRectPath(ctx, -w / 2, -h / 2, w, h, u * 0.28);
  ctx.fillStyle = grappling ? '#3a2c18' : plate;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, u * 0.10);
  ctx.strokeStyle = trim;
  ctx.stroke();
  // Umbo.
  ctx.beginPath();
  ctx.arc(0, 0, u * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = plateLit;
  ctx.fill();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Shield slams charge a ring of light around the rim.
  if ((attack === 'shield1' || attack === 'shield2') && f.q.glows) {
    ctx.save();
    ctx.globalAlpha = 0.25 + p * 0.55;
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = Math.max(1.5, u * 0.12);
    ctx.beginPath();
    ctx.ellipse(sx, sy, w * 0.62, h * 0.58, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  void s;
}

function drawSpear(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot,
  x: number, y: number, u: number, attack: BossAttack | null, p: number,
  trim: string, enraged: boolean,
): void {
  // Anchor at the weapon-side shoulder, in screen space (see drawShield).
  const handX = x + u * 1.15;
  const handY = y - u * 2.6;

  // Each attack gets its own shaft direction. These are the silhouettes
  // the player learns to read, so they must not converge.
  let ax: number;
  let ay: number;
  let len = u * 3.5;
  switch (attack) {
    case 'spear1':
      // Raised high and level: a sweep is coming.
      ax = -DIR.x * 0.35;
      ay = -1.0 - p * 0.15;
      len = u * (3.6 + p * 0.5);
      break;
    case 'spear2':
      // Drawn back low, tip forward: a thrust is coming.
      ax = DIR.x * (0.35 + p * 0.6);
      ay = DIR.y * (0.35 + p * 0.6) - 0.32 + p * 0.25;
      len = u * (3.4 + p * 1.5);
      break;
    case 'tripleParry':
      ax = -DIR.x * 0.15;
      ay = -0.95;
      len = u * 3.2;
      break;
    case 'grapple':
      ax = DIR.x;
      ay = DIR.y * 0.5 - 0.1;
      len = u * 2.4;
      break;
    default:
      ax = DIR.x * 0.15;
      ay = -0.85;
      len = u * 3.4;
      break;
  }
  const mag = Math.hypot(ax, ay) || 1;
  ax /= mag;
  ay /= mag;

  const tipX = handX + ax * len;
  const tipY = handY + ay * len * 0.82;
  const buttX = handX - ax * len * 0.32;
  const buttY = handY - ay * len * 0.26;

  ctx.strokeStyle = '#4a3a22';
  ctx.lineWidth = Math.max(1.6, u * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(buttX, buttY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Leaf blade.
  const bl = u * 0.75;
  const nx = -ay;
  const ny = ax;
  ctx.beginPath();
  ctx.moveTo(tipX + ax * bl * 0.6, tipY + ay * bl * 0.6);
  ctx.lineTo(tipX + nx * bl * 0.26, tipY + ny * bl * 0.26);
  ctx.lineTo(tipX - ax * bl * 0.5, tipY - ay * bl * 0.5);
  ctx.lineTo(tipX - nx * bl * 0.26, tipY - ny * bl * 0.26);
  ctx.closePath();
  ctx.fillStyle = enraged ? '#ffb14a' : '#cfc3a8';
  ctx.fill();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Charging glow at the tip as the wind-up completes.
  if ((attack === 'spear1' || attack === 'spear2') && f.q.glows && f.grad.telegraph) {
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.globalAlpha = 0.35 + p * 0.55;
    ctx.fillStyle = f.grad.telegraph;
    ctx.beginPath();
    ctx.arc(0, 0, u * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  void s;
}

// ----------------------------------------------------------------- player

export type WeaponCategory = 'melee' | 'ranged' | 'magic';

export interface PlayerVisual {
  /** Interpolated tile position. */
  x: number;
  y: number;
  /** Screen-space facing, unit length. */
  fx: number;
  fy: number;
  weapon: WeaponCategory;
  /** 0..1 — swing animation progress, 0 when idle. */
  swing: number;
  spec: boolean;
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, pv: PlayerVisual,
): void {
  const u = f.u;
  projectTile(f.cam, pv.x, pv.y, PT);
  const px = PT.x;
  const py = PT.y;
  const alive = s.playerAlive;
  const H = 2.4 * u;

  // Ground marks first, all tilting with the camera rather than with the
  // figure: shadow, run-energy arc, and the spec ring around the feet.
  if (f.q.shadows) {
    groundEllipse(ctx, px, py + u * 0.05, u * 0.52, u * 0.26, 'rgba(0,0,0,0.42)', f.flat);
  }

  // Run-energy arc under the feet: full ring = full energy.
  if (s.runEnergy < 100 || s.playerRunning) {
    ctx.beginPath();
    ctx.ellipse(px, py + u * 0.05, u * 0.60, u * 0.30 * f.flat, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.runEnergy / 100));
    ctx.strokeStyle = s.runEnergy < 25 ? '#e2571f' : C.playerTrim;
    ctx.lineWidth = Math.max(1.2, u * 0.09);
    ctx.stroke();
  }

  if (pv.spec) {
    ctx.strokeStyle = C.playerTrim;
    ctx.lineWidth = Math.max(1.5, u * 0.10);
    ctx.beginPath();
    ctx.ellipse(px, py + u * 0.02, u * 0.72, u * 0.36 * f.flat, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const upright = beginUpright(ctx, py, f.up);
  const bodyTop = py - H * 0.62;
  const headY = py - H * 0.82;

  // Cloak behind, body in front — enough to read facing without detail.
  ctx.fillStyle = alive ? C.playerCloak : C.playerDead;
  ctx.beginPath();
  ctx.moveTo(px - u * 0.34 - pv.fx * u * 0.16, bodyTop);
  ctx.lineTo(px + u * 0.34 - pv.fx * u * 0.16, bodyTop);
  ctx.lineTo(px + u * 0.28 - pv.fx * u * 0.30, py);
  ctx.lineTo(px - u * 0.28 - pv.fx * u * 0.30, py);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = alive ? C.player : C.playerDead;
  ctx.beginPath();
  ctx.moveTo(px - u * 0.26, bodyTop);
  ctx.lineTo(px + u * 0.26, bodyTop);
  ctx.lineTo(px + u * 0.20, py - u * 0.04);
  ctx.lineTo(px - u * 0.20, py - u * 0.04);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, headY, u * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = alive ? C.player : C.playerDead;
  ctx.fill();
  ctx.strokeStyle = C.playerTrim;
  ctx.lineWidth = 1;
  ctx.stroke();

  drawWeaponGlyph(ctx, px, py, u, pv);

  // Overhead stack, tight to the head so it reads as *this* player's state
  // rather than as free-floating chrome.
  drawMicroBars(ctx, s, px, headY - u * 1.02, u);
  drawPrayerGlyphs(ctx, s, px, headY - u * 1.85, u);
  endUpright(ctx, upright);
}

/** Abstract weapon tell: a blade, a bow arc, or a staff with an orb. */
function drawWeaponGlyph(
  ctx: CanvasRenderingContext2D, px: number, py: number, u: number, pv: PlayerVisual,
): void {
  const swing = pv.swing;
  const hx = px + pv.fx * u * 0.34;
  const hy = py - u * 0.9 + pv.fy * u * 0.14;
  ctx.strokeStyle = C.playerTrim;
  ctx.lineWidth = Math.max(1.4, u * 0.10);
  ctx.beginPath();
  if (pv.weapon === 'ranged') {
    const ang = Math.atan2(pv.fy, pv.fx);
    ctx.arc(hx, hy, u * 0.42, ang - 1.1, ang + 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(ang - 1.1) * u * 0.42, hy + Math.sin(ang - 1.1) * u * 0.42);
    ctx.lineTo(hx + Math.cos(ang + 1.1) * u * 0.42, hy + Math.sin(ang + 1.1) * u * 0.42);
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  if (pv.weapon === 'magic') {
    ctx.moveTo(hx, hy + u * 0.55);
    ctx.lineTo(hx + pv.fx * u * 0.20, hy - u * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx + pv.fx * u * 0.20, hy - u * 0.62, u * 0.15, 0, Math.PI * 2);
    ctx.fillStyle = C.playerCloakLit;
    ctx.fill();
    return;
  }
  // Melee: a short blade that kicks out during a swing.
  const ext = 0.35 + swing * 0.55;
  ctx.moveTo(hx, hy + u * 0.25);
  ctx.lineTo(hx + pv.fx * u * ext, hy + pv.fy * u * ext - u * 0.30);
  ctx.stroke();
}

/**
 * Overhead prayer state. Original glyphs: a shield with a diagonal bar
 * for Protect from Melee, a chevron star for the offensive prayer.
 */
function drawPrayerGlyphs(
  ctx: CanvasRenderingContext2D, s: SimSnapshot, x: number, y: number, u: number,
): void {
  const icons = (s.playerProtectMelee ? 1 : 0) + (s.playerOffensiveOn ? 1 : 0);
  if (icons === 0) return;
  const size = u * 0.46;
  let slot = -(icons - 1) / 2;

  if (s.playerProtectMelee) {
    const cx = x + slot * size * 2.3;
    ctx.beginPath();
    ctx.moveTo(cx - size, y - size);
    ctx.lineTo(cx + size, y - size);
    ctx.lineTo(cx + size, y + size * 0.15);
    ctx.quadraticCurveTo(cx, y + size * 1.25, cx - size, y + size * 0.15);
    ctx.closePath();
    ctx.fillStyle = '#2f5f8a';
    ctx.fill();
    ctx.strokeStyle = '#cfe4ff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.55, y + size * 0.45);
    ctx.lineTo(cx + size * 0.55, y - size * 0.65);
    ctx.stroke();
    slot += 1;
  }
  if (s.playerOffensiveOn) {
    const cx = x + slot * size * 2.3;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 - Math.PI / 2;
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      const ang2 = ang + Math.PI / 4;
      ctx.lineTo(cx + nx * size, y + ny * size);
      ctx.lineTo(cx + Math.cos(ang2) * size * 0.4, y + Math.sin(ang2) * size * 0.4);
    }
    ctx.closePath();
    ctx.fillStyle = '#c8281e';
    ctx.fill();
    ctx.strokeStyle = '#ffd7b0';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Small HP / prayer bars pinned over the player's head. */
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

// ------------------------------------------------------- overhead callouts

const SLOT_LABEL: Record<GrappleSlot, string> = {
  head: 'HEAD', body: 'BODY', legs: 'LEGS', weapon: 'WEAPON', shield: 'SHIELD',
};

/**
 * Grapple call-out: the body part Sol grabbed, plus a pip per remaining
 * parry tick. Four pips at the start, one extinguished per tick — the
 * last-lit pip is the perfect-parry tick.
 */
export function drawGrappleCallout(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, x: number, y: number,
): void {
  if (!s.grappleSlot || s.grappleWindowEnd < 0) return;
  const u = f.u;
  const total = s.grappleWindowEnd - s.grappleWindowStart + 1;
  const remaining = Math.max(0, Math.ceil(s.grappleWindowEnd - f.t + 1));
  const label = s.grappleParried
    ? (s.grapplePerfect ? 'PERFECT PARRY' : 'PARRIED')
    : `GRAPPLE — ${SLOT_LABEL[s.grappleSlot]}`;
  const tint = s.grappleParried ? (s.grapplePerfect ? HUD.accent : '#cfe4ff') : C.hazardEdge;

  ctx.font = FONT_LABEL;
  const w = Math.max(u * 5.4, ctx.measureText(label).width + u);
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x - w / 2, y - u * 1.5, w, u * 1.65, u * 0.2);
  ctx.fill();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  outlinedText(ctx, label, x, y - u * 0.78, tint, FONT_LABEL);

  // Parry-window pips.
  const pipR = Math.max(2.5, u * 0.17);
  const gap = pipR * 3;
  const startX = x - (gap * (total - 1)) / 2;
  for (let i = 0; i < total; i++) {
    // Pips extinguish left to right; the rightmost is the final tick of
    // the window — landing the parry on it is the perfect parry.
    const lit = !s.grappleParried && i >= total - remaining;
    const isPerfectPip = i === total - 1;
    ctx.beginPath();
    ctx.arc(startX + i * gap, y - u * 0.22, pipR, 0, Math.PI * 2);
    ctx.fillStyle = lit ? (isPerfectPip ? HUD.accent : C.hazardEdge) : 'rgba(255,255,255,0.14)';
    ctx.fill();
    if (isPerfectPip) {
      ctx.strokeStyle = HUD.accent;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/**
 * Triple Attack charge row: one pip per incoming swing, filling as its
 * hit tick approaches. The 3 / 3 / (3 or 4) spacing is visible as the
 * different fill rate of the third pip — which is exactly the thing that
 * catches people out below 50%.
 */
export function drawTripleCharge(
  ctx: CanvasRenderingContext2D, f: Frame, s: SimSnapshot, x: number, y: number,
): void {
  if (s.tripleHitTicks.length === 0) return;
  const u = f.u;
  const w = u * 5.2;
  const h = u * 0.42;
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x - w / 2, y - h * 1.6, w, h * 2.6, u * 0.16);
  ctx.fill();
  ctx.strokeStyle = C.hazardEdge;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  outlinedText(ctx, 'TRIPLE ATTACK', x, y - h * 0.8, C.hazardEdge, FONT_HUD_SM);

  const n = s.tripleHitTicks.length;
  const slotW = w / (n + 0.5);
  for (let i = 0; i < n; i++) {
    const hit = s.tripleHitTicks[i];
    const prev = i === 0 ? s.bossAttackDeclareTick : s.tripleHitTicks[i - 1];
    const span = Math.max(1, hit - prev);
    const fill = clamp01((f.t - prev) / span);
    const bx = x - w / 2 + slotW * (i + 0.4);
    const bw = slotW * 0.8;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(bx, y + h * 0.15, bw, h * 0.7);
    const done = f.t >= hit;
    ctx.fillStyle = done ? 'rgba(255,255,255,0.30)' : (fill > 0.82 ? HUD.accent : C.hazardEdge);
    ctx.fillRect(bx, y + h * 0.15, bw * (done ? 1 : fill), h * 0.7);
    // Longer bar = the slow third swing; the width itself is the tell.
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, y + h * 0.15, bw, h * 0.7);
  }
}

const ATTACK_LABEL: Record<BossAttack, string> = {
  spear1: 'SPEAR 1 — SWEEP',
  spear2: 'SPEAR 2 — THRUST',
  shield1: 'SHIELD 1 — INNER RING',
  shield2: 'SHIELD 2 — OUTER RING',
  tripleParry: 'TRIPLE ATTACK',
  grapple: 'GRAPPLE',
};

export function attackLabel(a: BossAttack): string { return ATTACK_LABEL[a]; }

/** Pixel height of one tile step, used to stack overhead UI. */
export function tileStepY(cam: Camera): number {
  return cam.mode === 'tactical' ? TAC_TILE * cam.scale : ISO_HH * cam.scale * 2;
}
