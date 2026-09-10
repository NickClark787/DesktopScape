/**
 * The Colosseum's renderer: everything specific to the Sol Heredit fight,
 * layered on the shared `ArenaRenderer` (loop, interpolation, camera,
 * pools, perf budget — see `renderer/arena/renderer.ts`).
 *
 * This class only decides *what* to draw and *when* to spawn effects. It
 * never derives fight state: hazard shapes, facings and timings all come
 * out of `SimSnapshot`.
 */
import { ARENA_H, ARENA_W, PHASE_THRESHOLDS } from '@sim/solHeredit/constants';
import type { AoeAttack, AssistOptions, SimEvent, SimSnapshot } from '@sim/solHeredit/types';
import { FxColor, FxKind } from '../../arena/effects';
import { drawEffects } from '../../arena/fxDraw';
import { FONT_LABEL, HUD, drawBossBar } from '../../arena/hud';
import type { GraphicsOptions, QualityProfile } from '../../arena/options';
import { ISO_HW, depthOf, projectTile, type Point } from '../../arena/projection';
import {
  ArenaRenderer, jitter, type RectAB, type RendererCallbacks, type SimHost,
} from '../../arena/renderer';
import { TileMask, TileSetCache, outlinedText } from '../../arena/shapes';
import {
  BOSS_UNIT, attackLabel, drawBoss, drawBossFootprint, drawGrappleCallout,
  drawPlayer, drawTripleCharge, facingScreenDir,
  type PlayerVisual, type WeaponCategory,
} from './actors';
import { ensureArenaLayer, type ArenaLayer } from './arenaLayer';
import {
  drawBeams, drawHazards, drawMarkers, drawSafeRingHint, drawSand,
  drawTransitionWash, syncTerrain, type TerrainCaches,
} from './overlay';
import { C, ColosseumGradients } from './palette';

const PT: Point = { x: 0, y: 0 };
const PT2: Point = { x: 0, y: 0 };
const DIRV: Point = { x: 0, y: 0 };

/** Damage sources the engine reports as typeless (Protect from Melee does
 *  not reduce them) — coloured differently so the distinction is visible. */
function isTypeless(source: string): boolean {
  return source === 'spear1' || source === 'spear2' || source === 'shield1'
    || source === 'shield2' || source === 'Molten sand' || source === 'Light beam';
}

export class ColosseumRenderer extends ArenaRenderer<SimSnapshot> {
  private assists: AssistOptions;
  private weapon: WeaponCategory = 'melee';
  private layer: ArenaLayer | null = null;
  private swingEndsAt = 0;

  private terrain: TerrainCaches = {
    hazard: new TileSetCache(ARENA_W * ARENA_H),
    sand: new TileSetCache(ARENA_W * ARENA_H),
    hazardMask: new TileMask(ARENA_W, ARENA_H),
    sandMask: new TileMask(ARENA_W, ARENA_H),
  };
  private pv: PlayerVisual = {
    x: 0, y: 0, fx: 0, fy: 1, weapon: 'melee', swing: 0, spec: false,
  };

  constructor(
    canvas: HTMLCanvasElement,
    host: SimHost<SimSnapshot>,
    opts: GraphicsOptions,
    assists: AssistOptions,
    cbs: RendererCallbacks,
  ) {
    super(canvas, host, opts, cbs, ARENA_W, ARENA_H, new ColosseumGradients());
    this.assists = assists;
  }

  setAssists(a: AssistOptions): void {
    this.assists = a;
    this.requestStill();
  }

  setWeapon(w: WeaponCategory): void { this.weapon = w; }

  private get grads(): ColosseumGradients { return this.grad as ColosseumGradients; }
  private get frameC() { return this.frame as typeof this.frame & { grad: ColosseumGradients }; }

  // ------------------------------------------------------------- contract

  protected tickOf(s: SimSnapshot): number { return s.tick; }

  protected playerTileOf(s: SimSnapshot, out: Point): Point {
    out.x = s.playerPos.x;
    out.y = s.playerPos.y;
    return out;
  }

  protected isFinished(s: SimSnapshot): boolean { return s.finished; }

  protected pendingInputCount(s: SimSnapshot): number { return s.pendingInputCount; }

  protected assistCount(): number {
    const a = this.assists;
    return (a.hazardOverlay ? 1 : 0) + (a.nextAttackPrediction ? 1 : 0)
      + (a.prayerTimingIndicator ? 1 : 0) + (a.safeTileHighlight ? 1 : 0);
  }

  protected outcomeBanner(s: SimSnapshot): { text: string; tint: string } | null {
    // Practice modes can end a run with the boss still standing, so the
    // outcome is read off the player, not off boss HP.
    const won = s.playerAlive && s.playerHp > 0;
    return { text: won ? 'SOL HEREDIT DEFEATED' : 'YOU DIED', tint: won ? '#3fbf5f' : '#ff7a66' };
  }

  protected override onReset(): void {
    this.terrain.hazard.invalidate();
    this.terrain.sand.invalidate();
  }

  protected override onDestroy(): void {
    if (this.layer) {
      this.layer.canvas.width = 0;
      this.layer.canvas.height = 0;
      this.layer = null;
    }
  }

  /**
   * The must-see rect: the player plus the 11×11 box around Sol, which
   * bounds every safe ring the shield slams leave. Framing shrinks until
   * this fits — a hidden safe tile is a lost attempt.
   */
  protected requiredRect(s: SimSnapshot, px: number, py: number, out: RectAB): void {
    const cx = s.bossAnchor.x + 2;
    const cy = s.bossAnchor.y + 2;
    out.a0 = Math.max(0, Math.min(px, cx - 5.5));
    out.a1 = Math.min(ARENA_W, Math.max(px + 1, cx + 6.5));
    out.b0 = Math.max(0, ARENA_H - 1 - Math.max(py, cy + 5.5));
    out.b1 = Math.min(ARENA_H, ARENA_H - Math.min(py, cy - 5.5));
  }

  /** Sol's art stands well above his tiles and the wind-up call-out sits
   *  above that again; tile framing alone slices his head off. */
  protected override keepVisible(s: SimSnapshot, w: number, h: number): void {
    void w;
    const u = this.frame.u || ISO_HW * this.cam.scale;
    this.nudgeForHeadroom(
      s.bossAnchor.x + 2, s.bossAnchor.y + 2,
      u * BOSS_UNIT * 5.2 * this.cam.up + CALLOUT_HEADROOM,
      this.curPlayer.playerX, this.curPlayer.playerY, h,
    );
  }

  // -------------------------------------------------------------- effects

  /**
   * Turn newly-emitted engine events into pooled effects. Runs once per
   * tick, never per frame — this is where every string the draw loop
   * prints gets built.
   *
   * Scatter is derived from the event index rather than `Math.random()`,
   * so scrubbing a replay back and forth reproduces the same picture.
   */
  protected onTickAdvanced(s: SimSnapshot): void {
    const events = this.host.getEvents() as readonly SimEvent[];
    const q = this.quality();
    const px = s.playerPos.x;
    const py = s.playerPos.y;

    for (let i = this.eventCursor; i < events.length; i++) {
      const e = events[i];
      const jx = jitter(i) * 1.2;
      const jy = jitter(i + 37) * 0.5;
      switch (e.type) {
        case 'playerHitBoss': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Hitsplat;
          fx.a = s.bossAnchor.x + 2;
          fx.b = s.bossAnchor.y + 2;
          fx.dx = jx;
          fx.dy = jy;
          fx.life = 900;
          fx.value = e.damage;
          fx.value2 = e.spec ? 1 : 0;
          fx.color = e.damage > 0 ? FxColor.Damage : FxColor.Miss;
          fx.text = String(e.damage);
          this.spawnSwing(s, e.spec, q);
          if (e.spec) this.spawnBurst(px, py, FxColor.Spec, q, 0.6);
          break;
        }
        case 'playerDamaged': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Hitsplat;
          fx.a = px; fx.b = py;
          fx.dx = jx * 0.75;
          fx.life = 1000;
          fx.value = e.amount;
          fx.color = isTypeless(e.source) ? FxColor.Typeless : FxColor.Damage;
          fx.text = String(e.amount);
          if (e.source !== 'Molten sand') this.spawnSlam(px, py, q);
          this.emitDust(px, py, q, FxColor.Typeless);
          break;
        }
        case 'playerDodged': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.life = 800;
          fx.color = FxColor.Safe;
          fx.text = 'DODGED';
          this.spawnAoeShock(s, e.attack, q);
          break;
        }
        case 'parryBlocked': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Burst;
          fx.a = px; fx.b = py;
          fx.life = 480;
          fx.color = FxColor.Safe;
          fx.value = 0.3;
          const t = this.fx.spawn(q.maxEffects);
          t.kind = FxKind.Text;
          t.a = px; t.b = py;
          t.life = 750;
          t.color = FxColor.Safe;
          t.text = 'BLOCKED';
          break;
        }
        case 'parryFailed': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Slam;
          fx.a = px; fx.b = py;
          fx.life = 520;
          fx.color = FxColor.Danger;
          break;
        }
        case 'grappleParried': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Burst;
          fx.a = px; fx.b = py;
          fx.life = e.perfect ? 900 : 600;
          fx.value = e.perfect ? 1.2 : 0.4;
          fx.color = e.perfect ? FxColor.Gold : FxColor.Safe;
          const t = this.fx.spawn(q.maxEffects);
          t.kind = FxKind.Text;
          t.a = px; t.b = py;
          t.life = 1100;
          t.color = e.perfect ? FxColor.Gold : FxColor.Safe;
          t.text = e.perfect ? 'PERFECT PARRY!' : 'PARRIED';
          if (e.perfect) this.emitDust(px, py, q, FxColor.Gold);
          break;
        }
        case 'grappleFailed': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Slam;
          fx.a = px; fx.b = py;
          fx.life = 620;
          fx.value = 0.8;
          fx.color = FxColor.Danger;
          break;
        }
        case 'beamHit': {
          const flash = this.fx.spawn(q.maxEffects);
          flash.kind = FxKind.Beam;
          flash.a = px; flash.b = py;
          flash.life = 420;
          flash.color = FxColor.Gold;
          if (e.prayerDrained > 0) {
            const t = this.fx.spawn(q.maxEffects);
            t.kind = FxKind.Hitsplat;
            t.a = px; t.b = py;
            t.dx = 0.9;
            t.dy = -0.35;
            t.life = 1100;
            t.value = e.prayerDrained;
            t.color = FxColor.Prayer;
            t.text = `-${e.prayerDrained}`;
          }
          break;
        }
        case 'phaseTransition': {
          const ring = this.fx.spawn(q.maxEffects);
          ring.kind = FxKind.Ring;
          ring.a = px; ring.b = py;
          ring.life = 1400;
          ring.value = 0.5;
          ring.value2 = 5;      // the 9×9 beam area, from its centre
          ring.color = FxColor.Gold;
          this.emitDust(px, py, q, FxColor.Gold);
          break;
        }
        case 'consumed': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.dx = -0.8;
          fx.life = 850;
          const potion = e.itemId.includes('potion') || e.itemId.includes('brew')
            || e.itemId.includes('restore') || e.itemId.includes('combat');
          fx.color = potion ? FxColor.Prayer : FxColor.Heal;
          fx.text = potion ? 'SIP' : 'EAT';
          break;
        }
        case 'prayer': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.dx = 0.9;
          fx.life = 620;
          fx.color = e.on ? FxColor.Safe : FxColor.Miss;
          fx.text = e.on ? 'PRAY ON' : 'PRAY OFF';
          break;
        }
        case 'inputDropped': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.dx = -1.1;
          fx.life = 1000;
          fx.color = FxColor.Miss;
          fx.text = 'PACKET LOST';
          break;
        }
        default:
          break;
      }
    }
    this.eventCursor = events.length;
  }

  private spawnSwing(s: SimSnapshot, spec: boolean, q: QualityProfile): void {
    const fx = this.fx.spawn(q.maxEffects);
    fx.kind = FxKind.Swing;
    fx.a = s.playerPos.x;
    fx.b = s.playerPos.y;
    projectTile(this.cam, s.playerPos.x, s.playerPos.y, PT);
    projectTile(this.cam, s.bossAnchor.x + 2, s.bossAnchor.y + 2, PT2);
    const dx = PT2.x - PT.x;
    const dy = PT2.y - PT.y;
    const len = Math.hypot(dx, dy) || 1;
    fx.dx = dx / len;
    fx.dy = dy / len;
    fx.life = 320;
    fx.value = spec ? 0.5 : 0.2;
    fx.color = spec ? FxColor.Spec : FxColor.Gold;
    // Wall-clock, not frame-counted: the arm extension must look the same
    // at 30 fps and at 120.
    this.swingEndsAt = performance.now() + SWING_MS;
  }

  private spawnBurst(x: number, y: number, color: FxColor, q: QualityProfile, size: number): void {
    const fx = this.fx.spawn(q.maxEffects);
    fx.kind = FxKind.Burst;
    fx.a = x; fx.b = y;
    fx.life = 520;
    fx.value = size;
    fx.color = color;
  }

  private spawnSlam(x: number, y: number, q: QualityProfile): void {
    const fx = this.fx.spawn(q.maxEffects);
    fx.kind = FxKind.Slam;
    fx.a = x; fx.b = y;
    fx.life = 500;
    fx.color = FxColor.Typeless;
  }

  /** Ground shock for a resolved AoE, sized to the shape that just landed. */
  private spawnAoeShock(s: SimSnapshot, attack: AoeAttack, q: QualityProfile): void {
    const fx = this.fx.spawn(q.maxEffects);
    fx.kind = FxKind.Ring;
    fx.a = s.bossAnchor.x + 2;
    fx.b = s.bossAnchor.y + 2;
    fx.life = 620;
    fx.value = 1.2;
    fx.value2 = attack === 'shield2' ? 5.5 : attack === 'shield1' ? 4.5 : 3.5;
    fx.color = FxColor.Typeless;
  }

  private emitDust(x: number, y: number, q: QualityProfile, color: FxColor): void {
    const n = q.burstParticles;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const v = 0.5 + jitter(i * 7) + 0.5;
      this.particles.emit(
        x, y,
        Math.cos(ang) * 1.4 * v, Math.sin(ang) * 1.4 * v,
        24 + v * 26,
        520 + v * 380,
        color, 0.07 + v * 0.06,
        q.maxParticles,
      );
    }
  }

  // ----------------------------------------------------------------- draw

  protected drawScene(
    ctx: CanvasRenderingContext2D, s: SimSnapshot, w: number, h: number, px: number, py: number,
  ): void {
    const f = this.frameC;
    const q = this.quality();

    // Static arena: one blit, re-projected onto the live orbit pose.
    this.layer = ensureArenaLayer(
      this.layer, this.opts.view, this.cam.scale, this.lastDpr, q,
      this.opts.quality, this.opts.showTileCoords,
      this.orbit.bakeYawDeg(), this.orbit.bakePitchDeg(),
    );
    this.blitStaticLayer(ctx, this.layer.canvas, this.layer.cam);

    // Terrain and hazards.
    syncTerrain(this.terrain, s);
    drawSand(ctx, f, this.terrain);
    drawHazards(ctx, f, s, this.terrain, this.assists.hazardOverlay, this.assists.safeTileHighlight);
    drawBossFootprint(ctx, f, s);
    drawMarkers(ctx, f, s, this.opts.showLatencyIndicator);
    drawBeams(ctx, f, s);

    // Actors, back to front. Depth comes from the camera, not a fixed
    // a + b: swing the camera round behind Sol and he has to draw in
    // front of the player, not behind them.
    this.updatePlayerVisual(s, px, py, performance.now());
    const bossDepth = depthOf(
      this.cam, s.bossAnchor.x + BOSS_HALF, ARENA_H - s.bossAnchor.y - BOSS_HALF,
    );
    const playerDepth = depthOf(this.cam, px + 0.5, ARENA_H - 1 - py + 0.5);
    if (bossDepth <= playerDepth) {
      drawBoss(ctx, f, s);
      drawPlayer(ctx, f, s, this.pv);
    } else {
      drawPlayer(ctx, f, s, this.pv);
      drawBoss(ctx, f, s);
    }

    drawEffects(ctx, f, this.fx, this.particles);

    // Overhead callouts, anchored to the boss.
    projectTile(this.cam, s.bossAnchor.x + 2, s.bossAnchor.y + 2, PT2);
    const calloutY = PT2.y - f.u * BOSS_UNIT * 5.2 * f.up;
    if (s.bossAttack === 'grapple') drawGrappleCallout(ctx, f, s, PT2.x, calloutY);
    else if (s.bossAttack === 'tripleParry') drawTripleCharge(ctx, f, s, PT2.x, calloutY);
    else if (s.bossAttack && this.opts.showAttackLabel) {
      outlinedText(ctx, attackLabel(s.bossAttack), PT2.x, calloutY, C.hazardEdge, FONT_LABEL);
      if (this.assists.nextAttackPrediction && s.bossAttackResolveTick > 0) {
        outlinedText(ctx, RESOLVE_LABELS[Math.max(0, Math.min(RESOLVE_LABELS.length - 1,
          Math.ceil(s.bossAttackResolveTick - f.t)))],
        PT2.x, calloutY + 15, HUD.accent, FONT_LABEL);
      }
    }
    drawSafeRingHint(ctx, f, s, PT2.x, calloutY + 18);

    // Prayer-timing assist: the explicit flick cue. The charge pips above
    // are always on (they mirror the animation); this spells out the tick,
    // so it is gated and flagged.
    if (this.assists.prayerTimingIndicator && s.tripleHitTicks.length > 0) {
      const next = s.bossAttackResolveTick;
      if (next > 0) {
        projectTile(this.cam, px, py, PT);
        const ticksOut = Math.ceil(next - f.t);
        outlinedText(ctx, ticksOut <= 1 ? 'FLICK NOW' : FLICK_LABELS[
          Math.min(FLICK_LABELS.length - 1, Math.max(0, ticksOut))],
        PT.x, PT.y - f.u * 3.6 * f.up,
        ticksOut <= 1 ? HUD.accent : HUD.dim, FONT_LABEL);
      }
    }

    drawTransitionWash(ctx, f, s, w, h);
    drawBossBar(ctx, w, {
      name: 'SOL HEREDIT',
      hp: s.bossHp,
      maxHp: s.bossMaxHp,
      thresholds: PHASE_THRESHOLDS,
      tint: s.enraged ? C.bossEnrage : undefined,
      subtitle: s.enraged ? 'ENRAGED' : undefined,
      subtitleTint: C.bossEnrage,
    });
  }

  private updatePlayerVisual(s: SimSnapshot, px: number, py: number, now: number): void {
    const pv = this.pv;
    pv.x = px;
    pv.y = py;
    pv.weapon = this.weapon;
    pv.spec = s.playerSpecArmed;
    pv.swing = Math.max(0, Math.min(1, (this.swingEndsAt - now) / SWING_MS));
    // Face the way we are travelling; when standing still, face Sol.
    let dx = this.curPlayer.playerX - this.prevPlayer.playerX;
    let dy = this.curPlayer.playerY - this.prevPlayer.playerY;
    if (dx === 0 && dy === 0) {
      dx = s.bossAnchor.x + 2 - px;
      dy = s.bossAnchor.y + 2 - py;
    }
    if (dx !== 0 || dy !== 0) {
      facingScreenDir(this.cam, Math.sign(dx), Math.sign(dy), DIRV);
      pv.fx = DIRV.x;
      pv.fy = DIRV.y;
    }
  }
}

const BOSS_HALF = 2.5;
const SWING_MS = 260;
/** Space above Sol's crest for the wind-up call-out. */
const CALLOUT_HEADROOM = 30;
/** "lands in N" strings, pre-built for the assist readout. */
const RESOLVE_LABELS = ['LANDS NOW', 'LANDS IN 1', 'LANDS IN 2', 'LANDS IN 3', 'LANDS IN 4',
  'LANDS IN 5', 'LANDS IN 6', 'LANDS IN 7', 'LANDS IN 8', 'LANDS IN 9', 'LANDS SOON'];
const FLICK_LABELS = ['FLICK NOW', 'FLICK NOW', 'FLICK IN 1', 'FLICK IN 2', 'FLICK IN 3',
  'FLICK IN 4', 'FLICK IN 5', 'FLICK IN 6'];
