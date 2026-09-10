/**
 * The Inferno's renderer: everything specific to the TzKal-Zuk fight,
 * layered on the shared `ArenaRenderer` (loop, interpolation, camera,
 * pools, perf budget — see `renderer/arena/renderer.ts`).
 *
 * This class only decides *what* to draw and *when* to spawn effects. It
 * never derives fight state: the glyph span, charge ticks, add windups
 * and revive timers all come out of `SimSnapshot`.
 */
import {
  ARENA_H, ARENA_W, ENRAGE_HP, JAD_SPAWN_HP, SET_PAUSE_HP, SET_RESUME_HP,
} from '@sim/tzkalZuk/constants';
import type { AssistOptions, EntitySnapshot, SimEvent, SimSnapshot } from '@sim/tzkalZuk/types';
import { FxColor, FxKind } from '../../arena/effects';
import { drawEffects } from '../../arena/fxDraw';
import { drawBossBar } from '../../arena/hud';
import type { GraphicsOptions, QualityProfile } from '../../arena/options';
import { ISO_HW, depthOf, projectTile, type Point } from '../../arena/projection';
import {
  ArenaRenderer, jitter, type RectAB, type RendererCallbacks, type SimHost,
} from '../../arena/renderer';
import {
  ADD_LABEL, ZUK_UNIT, drawAdd, drawGlyph, drawHealBeam, drawPlayer, drawZuk,
  drawZukFootprint, entityCentre, zukCentre, type PlayerVisual,
} from './actors';
import { ensureArenaLayer, type ArenaLayer } from './arenaLayer';
import {
  drawEnrageWash, drawExposureLane, drawGlyphGoneWarning, drawGlyphSafeTiles,
  drawMarkers, drawSetCountdown, drawZukCharge,
} from './overlay';
import { C, InfernoGradients } from './palette';

const PT: Point = { x: 0, y: 0 };
const PT2: Point = { x: 0, y: 0 };

/** Zuk's shot is typeless and unpreventable; add hits are style-based. */
function isTypeless(source: string): boolean {
  return source === 'TzKal-Zuk';
}

export class InfernoRenderer extends ArenaRenderer<SimSnapshot> {
  private assists: AssistOptions;
  private layer: ArenaLayer | null = null;
  private shootEndsAt = 0;
  /** Ticks on which a healer pulse fired, so the beams show for a beat. */
  private healBeamUntil = 0;

  private pv: PlayerVisual = { x: 0, y: 0, fx: 0, fy: -1, shoot: 0 };
  /** Scratch for the glyph safe-tile sweep — allocated once. */
  private readonly safeXs = new Int16Array(ARENA_W * ARENA_H);
  private readonly safeYs = new Int16Array(ARENA_W * ARENA_H);

  constructor(
    canvas: HTMLCanvasElement,
    host: SimHost<SimSnapshot>,
    opts: GraphicsOptions,
    assists: AssistOptions,
    cbs: RendererCallbacks,
  ) {
    super(canvas, host, opts, cbs, ARENA_W, ARENA_H, new InfernoGradients());
    this.assists = assists;
  }

  setAssists(a: AssistOptions): void {
    this.assists = a;
    this.requestStill();
  }

  private get frameI() { return this.frame as typeof this.frame & { grad: InfernoGradients }; }

  protected override backgroundColor(): string { return C.void; }

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
    return (a.glyphSafeHighlight ? 1 : 0) + (a.addTimers ? 1 : 0)
      + (a.jadPrayerIndicator ? 1 : 0) + (a.setCountdown ? 1 : 0);
  }

  protected outcomeBanner(s: SimSnapshot): { text: string; tint: string } | null {
    const won = s.playerAlive && s.playerHp > 0;
    return { text: won ? 'TZKAL-ZUK DEFEATED' : 'YOU DIED', tint: won ? '#3fbf5f' : '#ff7a66' };
  }

  protected override onDestroy(): void {
    if (this.layer) {
      this.layer.canvas.width = 0;
      this.layer.canvas.height = 0;
      this.layer = null;
    }
  }

  /**
   * The must-see rect: the player, the glyph's current span, and Zuk. The
   * glyph is the only thing standing between the player and a 148, so
   * framing that pushes it off screen is framing that kills you.
   */
  protected requiredRect(s: SimSnapshot, px: number, py: number, out: RectAB): void {
    let x0 = Math.min(px, s.zukAnchor.x);
    let x1 = Math.max(px + 1, s.zukAnchor.x + s.zukSize);
    if (s.glyphSpan) {
      x0 = Math.min(x0, s.glyphSpan.x0);
      x1 = Math.max(x1, s.glyphSpan.x1);
    }
    // Adds fire from anywhere on the platform; keep them all in view.
    for (let i = 0; i < s.entities.length; i++) {
      const e = s.entities[i];
      x0 = Math.min(x0, e.pos.x);
      x1 = Math.max(x1, e.pos.x + e.size);
    }
    out.a0 = Math.max(0, x0);
    out.a1 = Math.min(ARENA_W, x1);
    // Zuk fires from the north wall and the player fights from the south,
    // so the full depth of the platform is always required.
    out.b0 = 0;
    out.b1 = ARENA_H;
    void py;
  }

  /** Zuk's art towers over his tiles; tile framing alone decapitates him. */
  protected override keepVisible(s: SimSnapshot, w: number, h: number): void {
    void w;
    const u = this.frame.u || ISO_HW * this.cam.scale;
    this.nudgeForHeadroom(
      s.zukAnchor.x + s.zukSize / 2, s.zukAnchor.y + s.zukSize / 2,
      u * ZUK_UNIT * 4.0 * this.cam.up + CALLOUT_HEADROOM,
      this.curPlayer.playerX, this.curPlayer.playerY, h,
    );
  }

  // -------------------------------------------------------------- effects

  /**
   * Turn newly-emitted engine events into pooled effects. Runs once per
   * tick, never per frame — every string the draw loop prints is built
   * here. Scatter comes from the event index, not `Math.random()`, so
   * scrubbing a replay reproduces the same picture.
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
        case 'zukAttack': {
          if (e.blocked) {
            // Absorbed by the glyph: the flash belongs on the shield, not
            // the player, so the cause is obvious.
            const span = s.glyphSpan;
            const bx = span ? (span.x0 + span.x1) / 2 : px;
            const by = span ? span.row : py;
            const fx = this.fx.spawn(q.maxEffects);
            fx.kind = FxKind.Burst;
            fx.a = bx; fx.b = by;
            fx.life = 520;
            fx.value = 0.9;
            fx.color = FxColor.Miss;
            const t = this.fx.spawn(q.maxEffects);
            t.kind = FxKind.Text;
            t.a = bx; t.b = by;
            t.life = 800;
            t.color = FxColor.Miss;
            t.text = 'ABSORBED';
          } else {
            const fx = this.fx.spawn(q.maxEffects);
            fx.kind = FxKind.Beam;
            fx.a = px; fx.b = py;
            fx.life = 460;
            fx.color = FxColor.Typeless;
            this.emitDust(px, py, q, FxColor.Typeless);
          }
          break;
        }
        case 'glyphDestroyed': {
          const span = s.glyphSpan;
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Ring;
          fx.a = span ? (span.x0 + span.x1) / 2 : px;
          fx.b = span ? span.row : py;
          fx.life = 1500;
          fx.value = 0.5;
          fx.value2 = 8;
          fx.color = FxColor.Danger;
          const t = this.fx.spawn(q.maxEffects);
          t.kind = FxKind.Text;
          t.a = px; t.b = py;
          t.life = 1600;
          t.color = FxColor.Danger;
          t.text = 'SHIELD DESTROYED';
          break;
        }
        case 'playerDamaged': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Hitsplat;
          fx.a = px; fx.b = py;
          fx.dx = jx * 0.75;
          fx.dy = jy;
          fx.life = 1000;
          fx.value = e.amount;
          fx.color = isTypeless(e.source) ? FxColor.Typeless : FxColor.Damage;
          fx.text = String(e.amount);
          break;
        }
        case 'addAttack': {
          if (e.blocked) {
            const fx = this.fx.spawn(q.maxEffects);
            fx.kind = FxKind.Hitsplat;
            fx.a = px; fx.b = py;
            fx.dx = jx * 0.8;
            fx.life = 800;
            fx.color = FxColor.Miss;
            fx.text = '0';
          }
          // An unblocked hit already produces a `playerDamaged` splat; a
          // second one here would double-count the same swing.
          break;
        }
        case 'playerHit': {
          const target = this.findEntity(s, e.targetId);
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Hitsplat;
          if (target) {
            fx.a = target.pos.x + target.size / 2 - 0.5;
            fx.b = target.pos.y + target.size / 2 - 0.5;
          } else {
            fx.a = s.zukAnchor.x + s.zukSize / 2 - 0.5;
            fx.b = s.zukAnchor.y + s.zukSize / 2 - 0.5;
          }
          fx.dx = jx;
          fx.dy = jy;
          fx.life = 900;
          fx.value = e.damage;
          fx.color = e.damage > 0 ? FxColor.Damage : FxColor.Miss;
          fx.text = String(e.damage);
          this.shootEndsAt = performance.now() + SHOOT_MS;
          break;
        }
        case 'addKilled': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.dx = 1.1;
          fx.life = 900;
          fx.color = FxColor.Safe;
          fx.text = `${ADD_LABEL[e.kind]} DOWN`;
          break;
        }
        case 'monsterRevived': {
          const target = this.findEntity(s, e.entityId);
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Burst;
          fx.a = target ? target.pos.x + 1 : px;
          fx.b = target ? target.pos.y + 1 : py;
          fx.life = 700;
          fx.value = 0.8;
          fx.color = FxColor.Prayer;
          break;
        }
        case 'zukHealed': {
          this.healBeamUntil = s.tick + 1;
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Hitsplat;
          fx.a = s.zukAnchor.x + s.zukSize / 2 - 0.5;
          fx.b = s.zukAnchor.y + s.zukSize / 2 - 0.5;
          fx.dx = jx;
          fx.life = 900;
          fx.value = e.amount;
          fx.color = FxColor.Heal;
          fx.text = `+${e.amount}`;
          break;
        }
        case 'addSpawned': {
          const target = this.findEntity(s, e.entityId);
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Ring;
          fx.a = target ? target.pos.x + target.size / 2 - 0.5 : px;
          fx.b = target ? target.pos.y + target.size / 2 - 0.5 : py;
          fx.life = 900;
          fx.value = 0.3;
          fx.value2 = 2.4;
          fx.color = e.kind === 'mager' ? FxColor.Miss
            : e.kind === 'healer' ? FxColor.Prayer : FxColor.Safe;
          const t = this.fx.spawn(q.maxEffects);
          t.kind = FxKind.Text;
          t.a = fx.a; t.b = fx.b;
          t.life = 1100;
          t.color = fx.color;
          t.text = ADD_LABEL[e.kind];
          break;
        }
        case 'enrage': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.life = 1600;
          fx.color = FxColor.Danger;
          fx.text = 'ZUK ENRAGED';
          this.emitDust(px, py, q, FxColor.Typeless);
          break;
        }
        case 'prayer': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.dx = 0.9;
          fx.life = 620;
          fx.color = e.overhead === 'magic' ? FxColor.Miss
            : e.overhead === 'ranged' ? FxColor.Safe : FxColor.Damage;
          fx.text = e.overhead ? `PRAY ${e.overhead.toUpperCase()}` : 'PRAY OFF';
          break;
        }
        case 'consumed': {
          const fx = this.fx.spawn(q.maxEffects);
          fx.kind = FxKind.Text;
          fx.a = px; fx.b = py;
          fx.dx = -0.8;
          fx.life = 850;
          const potion = e.itemId.includes('potion') || e.itemId.includes('brew')
            || e.itemId.includes('restore') || e.itemId.includes('ranging');
          fx.color = potion ? FxColor.Prayer : FxColor.Heal;
          fx.text = potion ? 'SIP' : 'EAT';
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

  private findEntity(s: SimSnapshot, id: number): EntitySnapshot | null {
    for (let i = 0; i < s.entities.length; i++) if (s.entities[i].id === id) return s.entities[i];
    return null;
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
    const f = this.frameI;
    const q = this.quality();

    // Static platform: one blit, re-projected onto the live orbit pose.
    this.layer = ensureArenaLayer(
      this.layer, this.opts.view, this.cam.scale, this.lastDpr, q,
      this.opts.quality, this.opts.showTileCoords,
      this.orbit.bakeYawDeg(), this.orbit.bakePitchDeg(),
    );
    this.blitStaticLayer(ctx, this.layer.canvas, this.layer.cam);

    drawGlyphGoneWarning(ctx, f, s);
    drawZukFootprint(ctx, f, s);
    if (this.assists.glyphSafeHighlight) {
      drawGlyphSafeTiles(ctx, f, s, this.safeXs, this.safeYs);
    }
    drawMarkers(ctx, f, s, this.opts.showLatencyIndicator);
    drawExposureLane(ctx, f, s, px, py);

    // Zuk sits at the north wall — always furthest back.
    drawZuk(ctx, f, s);
    drawGlyph(ctx, f, s);

    // Adds and the player, back to front on camera depth — the ordering
    // has to follow the camera round, not a fixed a + b.
    this.updatePlayerVisual(s, px, py, performance.now());
    const playerDepth = depthOf(this.cam, px + 0.5, ARENA_H - 1 - py + 0.5);
    for (let i = 0; i < s.entities.length; i++) {
      const e = s.entities[i];
      const d = depthOf(this.cam, e.pos.x + e.size / 2, ARENA_H - e.pos.y - e.size / 2);
      if (d > playerDepth) continue;
      this.drawOneAdd(ctx, s, e);
    }
    drawPlayer(ctx, f, s, this.pv);
    for (let i = 0; i < s.entities.length; i++) {
      const e = s.entities[i];
      const d = depthOf(this.cam, e.pos.x + e.size / 2, ARENA_H - e.pos.y - e.size / 2);
      if (d <= playerDepth) continue;
      this.drawOneAdd(ctx, s, e);
    }

    // Healer beams, drawn on the tick the pulse fired.
    if (s.tick <= this.healBeamUntil) {
      for (let i = 0; i < s.entities.length; i++) {
        const e = s.entities[i];
        if (e.kind === 'healer' && e.alive) drawHealBeam(ctx, f, e, s);
      }
    }

    drawEffects(ctx, f, this.fx, this.particles);

    // Zuk's charge readout, over his crown.
    zukCentre(s, this.cam, PT2);
    drawZukCharge(ctx, f, s, PT2.x, PT2.y - f.u * ZUK_UNIT * 3.9 * f.up);

    drawEnrageWash(ctx, f, s, w, h);
    if (this.assists.setCountdown) drawSetCountdown(ctx, f, s, w);

    drawBossBar(ctx, w, {
      name: 'TZKAL-ZUK',
      hp: s.zukHp,
      maxHp: s.zukMaxHp,
      thresholds: this.thresholdsFor(s.zukMaxHp),
      tint: s.enraged ? C.zukEnrage : undefined,
      subtitle: s.enraged ? 'ENRAGED — HEALERS UP'
        : s.glyphDestroyed ? 'SHIELD DESTROYED' : undefined,
      subtitleTint: s.enraged ? C.zukEnrage : C.dangerEdge,
    });

    // Glyph integrity under the boss bar: it is the second health bar that
    // actually matters, and losing it silently is a run-ender. Sits below
    // the subtitle row so an "ENRAGED" line never lands on top of it.
    if (!s.glyphDestroyed) {
      const gx = w / 2 - 180;
      const gy = s.enraged ? 46 : 34;
      const frac = s.glyphMaxHp > 0 ? s.glyphHp / s.glyphMaxHp : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(gx, gy, 360, 5);
      ctx.fillStyle = frac > 0.35 ? C.glyph : '#ffb14a';
      ctx.fillRect(gx, gy, 360 * Math.max(0, frac), 5);
    }
  }

  /**
   * The HP gates that change the fight, as fractions of max HP: the
   * set-timer pause band, Jad's spawn and enrage. Cached on max HP so the
   * boss bar never allocates an array per frame.
   */
  private readonly thresholds = [0, 0, 0, 0];
  private thresholdsMaxHp = -1;
  private thresholdsFor(maxHp: number): readonly number[] {
    if (maxHp !== this.thresholdsMaxHp && maxHp > 0) {
      this.thresholdsMaxHp = maxHp;
      this.thresholds[0] = SET_PAUSE_HP / maxHp;
      this.thresholds[1] = SET_RESUME_HP / maxHp;
      this.thresholds[2] = JAD_SPAWN_HP / maxHp;
      this.thresholds[3] = ENRAGE_HP / maxHp;
    }
    return this.thresholds;
  }

  private drawOneAdd(ctx: CanvasRenderingContext2D, s: SimSnapshot, e: EntitySnapshot): void {
    // The Jad prayer indicator is an assist; the ring colour on every add
    // is not — it mirrors the attack animation you can already see.
    const showTimer = this.assists.addTimers
      || (this.assists.jadPrayerIndicator && e.kind === 'jad');
    drawAdd(ctx, this.frameI, e, e.id === s.targetId, showTimer);
  }

  private updatePlayerVisual(s: SimSnapshot, px: number, py: number, now: number): void {
    const pv = this.pv;
    pv.x = px;
    pv.y = py;
    pv.shoot = Math.max(0, Math.min(1, (this.shootEndsAt - now) / SHOOT_MS));
    // Face whatever we are shooting at; Zuk when nothing else is targeted.
    const target = this.findEntity(s, s.targetId);
    projectTile(this.cam, px, py, PT);
    if (target) entityCentre(target, this.cam, PT2);
    else zukCentre(s, this.cam, PT2);
    const dx = PT2.x - PT.x;
    const dy = PT2.y - PT.y;
    const len = Math.hypot(dx, dy) || 1;
    pv.fx = dx / len;
    pv.fy = dy / len;
  }
}

const SHOOT_MS = 260;
/** Space above Zuk's crown for the charge call-out. */
const CALLOUT_HEADROOM = 34;
/** The HP gates that change the fight, as fractions of max HP. */
