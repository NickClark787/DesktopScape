/**
 * The TzKal-Zuk (Inferno wave 69) simulation engine. Headless,
 * deterministic, tick-driven — one `advance()` = 0.6s. Mirrors the Sol
 * Heredit engine's design: two seeded RNG streams (sim + network), a fixed
 * per-tick pipeline, player offense from the shared `calcDps`, replay via
 * re-simulation.
 *
 * The fight is a ranged prayer-switching endurance test rather than a melee
 * dodge: you keep the patrolling Ancestral Glyph between you and Zuk's
 * unpreventable shot, and you keep the spawns off the shield — everything
 * that spawns attacks the *shield* until you tag it (wiki `TzKal-Zuk`), and
 * the shield only has 600 HP against them.
 */
import { calcDps } from '@engine/formulas';
import type { CalcResult, Monster, PlayerLoadout } from '@shared/types';
import {
  ADD_ATTACK_DELAY,
  ARENA_H,
  ARENA_W,
  ENRAGE_HP,
  GLYPH_MAX_HP,
  HEALER_AOE_MAX,
  HEALER_AOE_MIN,
  HEALER_COUNT,
  HEALER_HEAL_INTERVAL,
  HEALER_HEAL_MAX,
  HEALER_HEAL_MIN,
  HEALER_HP,
  HEALER_SIZE,
  HEALER_SPEED,
  INFERNO_MODIFIERS,
  JAD_ATTACK_DELAY,
  JAD_HEALER_COUNT,
  JAD_HEALER_HP,
  JAD_HEALER_MAX_HIT,
  JAD_HEALER_SPEED,
  JAD_HEAL_AMOUNT,
  JAD_HEAL_INTERVAL,
  JAD_HP,
  JAD_MAX_HIT,
  JAD_SIZE,
  JAD_SPAWN_HP,
  JAD_SPEED,
  MAGER_HP,
  MAGER_MAX_HIT,
  MAGER_REVIVE_BUSY_TICKS,
  MAGER_REVIVE_CHANCE,
  MAGER_SIZE,
  MAGER_SPEED,
  RANGER_HP,
  RANGER_MAX_HIT,
  RANGER_SIZE,
  RANGER_SPEED,
  REVIVED_ATTACK_DELAY,
  SET_INTERVAL_TICKS,
  SET_PAUSE_BONUS_TICKS,
  SET_PAUSE_HP,
  SET_RESUME_HP,
  TICK_MS,
  ZUK_ATTACK_DELAY,
  ZUK_MAX_HIT,
  ZUK_SIZE,
  ZUK_SPEED,
  ZUK_SPEED_ENRAGED,
} from './constants';
import { Glyph } from './glyph';
import {
  normalAccuracy, npcAttackRoll, playerDefenceRoll,
  zukHitChance, type DefenceStyle, type PlayerDefenceInput,
} from './npcCombat';
import { consume, initPlayer, tickMovement, tickPlayerUpkeep, type PlayerState } from './player';
import { makeRng, type Rng } from './rng';
import type {
  AddStyle,
  Aggro,
  EntitySnapshot,
  EntityKind,
  InputCommand,
  ModifierEffects,
  Overhead,
  SimConfig,
  SimEvent,
  SimSnapshot,
  TimedInput,
  Vec,
} from './types';

interface PendingInput { cmd: InputCommand; effectTick: number; seq: number }

/** An `EntitySnapshot` plus its own reusable windup object, so refreshing
 *  the view never allocates. */
type PooledEntityView = {
  -readonly [K in keyof EntitySnapshot]: EntitySnapshot[K]
} & { windupSlot: { style: AddStyle; landTick: number } };

/** A declared-but-not-landed attack. `target` is latched at declare time:
 *  a shot already in the air at the shield still lands on the shield. */
interface Windup { style: AddStyle; landTick: number; target: Aggro }

interface Entity {
  id: number;
  kind: EntityKind;
  monster: Monster | null;
  pos: Vec;
  size: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  style: AddStyle | null;
  speed: number;
  maxHit: number;
  nextAttackTick: number;
  windup: Windup | null;
  /** What it is attacking. Spawns start on the shield (wiki). */
  aggro: Aggro;
  /** Set the first time the player attacks it. */
  tagged: boolean;
  /** True for a monster a Jal-Zek brought back — each may be revived once. */
  revived: boolean;
  /** Jal-Zek cannot attack while casting a revive nor for 7 ticks after. */
  busyUntil: number;
  /** Ticks accumulated toward the next heal (Jal-MejJak / Yt-HurKot). */
  healCounter: number;
  /** Entity this one heals, or -1. Zuk is 0. */
  healTargetId: number;
  /** Jad only: its Yt-HurKot half-health spawn has already fired. */
  spawnedHealers: boolean;
}

const KIND_LABEL: Record<EntityKind, string> = {
  zuk: 'TzKal-Zuk', ranger: 'Jal-Xil', mager: 'Jal-Zek', jad: 'JalTok-Jad',
  healer: 'Jal-MejJak', jadHealer: 'Yt-HurKot',
};

/** Which overhead blocks which incoming style. */
const OVERHEAD_FOR: Record<AddStyle, Overhead> = { ranged: 'ranged', magic: 'magic', melee: 'melee' };
/** Which of the player's defensive stats an incoming style rolls against. */
const DEFENCE_STYLE_FOR: Record<AddStyle, DefenceStyle> = { ranged: 'ranged', magic: 'magic', melee: 'crush' };

export class TzKalZukSim {
  readonly config: SimConfig;
  readonly events: SimEvent[] = [];
  readonly inputLog: TimedInput[] = [];

  private simRng: Rng;
  private netRng: Rng;
  private tickNum = 0;
  private inputSeq = 0;
  private pending: PendingInput[] = [];

  player: PlayerState;
  entities: Entity[] = [];
  private nextEntityId = 1;

  glyph: Glyph;
  glyphHp: number;
  glyphMaxHp: number;
  glyphDestroyed = false;
  /** Total shield HP the spawns have chewed through. */
  glyphDamageTaken = 0;

  private zuk: Entity;
  zukMaxHp: number;
  enraged = false;

  private mods: ModifierEffects;
  private setTimer: number;
  private firstSetDone = false;
  private setPauseBonusApplied = false;
  private jadSpawned = false;
  private healersSpawned = false;

  private calcCache = new Map<string, CalcResult>();
  /** Pooled render views for the adds — see `updateSnapshot`. */
  private entityView: PooledEntityView[] = [];
  /** Reused defence-roll input so per-attack accuracy never allocates. */
  private defInput: PlayerDefenceInput;
  /** Latency readout for the HUD: how late the last accepted input lands. */
  private lastInputLagTicks = -1;
  finished = false;
  outcome: 'kill' | 'death' | 'timeout' | null = null;

  private snapshot: SimSnapshot;

  constructor(config: SimConfig) {
    this.config = config;
    this.simRng = makeRng(config.seed >>> 0);
    this.netRng = makeRng((config.seed ^ 0x9e3779b9) >>> 0);

    // Merge modifier effects (declarative list).
    this.mods = {};
    for (const id of config.boss.modifierIds) {
      const m = INFERNO_MODIFIERS.find((x) => x.id === id);
      if (!m) continue;
      this.mods = {
        disableGlyph: this.mods.disableGlyph || m.effects.disableGlyph,
        glyphHp: m.effects.glyphHp ?? this.mods.glyphHp,
        setIntervalMult: (this.mods.setIntervalMult ?? 1) * (m.effects.setIntervalMult ?? 1),
        incomingDamageMult: (this.mods.incomingDamageMult ?? 1) * (m.effects.incomingDamageMult ?? 1),
      };
    }

    this.zukMaxHp = config.monster.skills.hp;
    const startFrac = Math.max(1, Math.min(100, config.boss.startHpPct)) / 100;
    const startHp = Math.max(1, Math.ceil(this.zukMaxHp * startFrac));

    // Zuk = entity 0, a 7x7 block at the north wall.
    const zx0 = Math.floor((ARENA_W - ZUK_SIZE) / 2);
    this.zuk = {
      id: 0, kind: 'zuk', monster: config.monster,
      pos: { x: zx0, y: ARENA_H - ZUK_SIZE },
      size: ZUK_SIZE, hp: startHp, maxHp: this.zukMaxHp, alive: true,
      style: null, speed: ZUK_SPEED, maxHit: ZUK_MAX_HIT,
      nextAttackTick: ZUK_SPEED, windup: null, aggro: 'player', tagged: true,
      revived: false, busyUntil: -1, healCounter: 0, healTargetId: -1, spawnedHealers: false,
    };
    this.entities.push(this.zuk);

    this.glyph = new Glyph(0);
    this.glyphMaxHp = this.mods.glyphHp ?? GLYPH_MAX_HP;
    this.glyphHp = this.glyphMaxHp;
    if (this.mods.disableGlyph) this.glyphDestroyed = true;

    this.setTimer = Math.round(SET_INTERVAL_TICKS * (this.mods.setIntervalMult ?? 1));

    this.player = initPlayer(config.player, { x: Math.floor(ARENA_W / 2), y: 2 });
    this.defInput = {
      skills: config.player.skills,
      boosts: this.player.boosts,
      equipment: config.player.loadout.equipment,
      stance: config.player.loadout.stance,
      rigour: false,
    };

    this.applyPracticeStart();

    this.snapshot = this.blankSnapshot();
    this.updateSnapshot();
  }

  /** Practice modes fast-forward the fight state at start. */
  private applyPracticeStart(): void {
    const mode = this.config.boss.practiceMode;
    if (mode === 'jad' && this.zuk.hp > JAD_SPAWN_HP) this.zuk.hp = JAD_SPAWN_HP;
    if (mode === 'healers' && this.zuk.hp > ENRAGE_HP) this.zuk.hp = ENRAGE_HP;
    // The HP-gated spawns fire on the first tick via checkHpTriggers().
  }

  // ------------------------------------------------------------ inputs

  queueInput(input: TimedInput): void {
    this.inputLog.push(input);
    const { pingMs, jitterMs, packetLossPct } = this.config.latency;
    const jitter = jitterMs > 0 ? (this.netRng.next() * 2 - 1) * jitterMs : 0;
    if (packetLossPct > 0 && this.netRng.chance(packetLossPct / 100)) {
      this.events.push({ tick: input.clientTick, type: 'inputDropped', cmd: input.cmd });
      return;
    }
    const arriveMs = input.clientTick * TICK_MS + input.msIntoTick + Math.max(0, pingMs + jitter);
    const effectTick = Math.floor(arriveMs / TICK_MS) + 1;
    this.lastInputLagTicks = effectTick - input.clientTick;
    this.pending.push({ cmd: input.cmd, effectTick, seq: this.inputSeq++ });
  }

  // ------------------------------------------------------------ tick

  get tick(): number { return this.tickNum; }

  advance(): void {
    if (this.finished) return;
    this.tickNum++;
    const t = this.tickNum;

    // 1. Inputs.
    this.pending.sort((a, b) => a.effectTick - b.effectTick || a.seq - b.seq);
    while (this.pending.length && this.pending[0].effectTick <= t) {
      this.applyInput(this.pending.shift()!.cmd, t);
    }

    // 2. Player upkeep + movement.
    tickPlayerUpkeep(this.player, t, this.prayerBonus());
    tickMovement(this.player);

    // 3. Glyph patrol + first-set gate.
    if (!this.glyphDestroyed) this.glyph.step(this.config.boss.freezeGlyph);

    // 4. HP-gated spawns (Jad @480, enrage+healers @240).
    this.checkHpTriggers(t);

    // 5. Add-set spawn timer.
    this.tickSetTimer(t);

    // 6. Zuk attack.
    this.tickZuk(t);

    // 7. Adds (movement is abstract; they attack on cadence).
    this.tickAdds(t);

    // 8. Healers heal their charge.
    this.tickHealers(t);

    // 9. Player auto-attack.
    this.tickPlayerAttack(t);

    // 10. End conditions.
    if (this.player.hp <= 0 && this.player.alive) {
      this.player.alive = false;
      this.events.push({ tick: t, type: 'death' });
      this.finish('death');
    }
    if (this.zuk.hp <= 0 && !this.finished) {
      this.events.push({ tick: t, type: 'zukKilled' });
      this.finish('kill');
    }

    this.updateSnapshot();
  }

  private finish(outcome: 'kill' | 'death' | 'timeout'): void {
    this.finished = true;
    this.outcome = outcome;
  }

  // ------------------------------------------------------------ Zuk

  private tickZuk(t: number): void {
    const z = this.zuk;
    if (!z.alive || this.finished) return;

    // Resolve a pending shot.
    if (z.windup && t === z.windup.landTick) {
      const covered = !this.glyphDestroyed && !this.mods.disableGlyph && this.glyph.protects(this.player.pos);
      if (covered) {
        // Wiki `Ancestral glyph`: "It can sustain TzKal-Zuk's attacks
        // indefinitely" — the shield takes no damage from Zuk himself.
        this.events.push({ tick: t, type: 'zukAttack', blocked: true, hit: false, damage: 0 });
      } else {
        // Typeless hybrid: prayer does not help and it cannot be tick-eaten.
        // Zuk still rolls accuracy (Mod Ash: average ranged/magic accuracy
        // vs the average of the player's ranged and magic defence).
        const hit = this.simRng.next() < zukHitChance(this.config.monster, this.defenceInput());
        const dmg = hit ? this.applyIncomingMult(this.simRng.int(ZUK_MAX_HIT)) : 0;
        this.events.push({ tick: t, type: 'zukAttack', blocked: false, hit, damage: dmg });
        this.damagePlayer(dmg, 'TzKal-Zuk', 'stay behind the Ancestral Glyph (move with it)');
      }
      z.windup = null;
    }

    // Declare the next shot.
    if (t >= z.nextAttackTick && !z.windup) {
      const land = t + ZUK_ATTACK_DELAY;
      z.windup = { style: 'ranged', landTick: land, target: 'player' };
      z.nextAttackTick = t + (this.enraged ? ZUK_SPEED_ENRAGED : ZUK_SPEED);
      this.events.push({ tick: t, type: 'zukAttackDeclared', landTick: land });
    }
  }

  // ------------------------------------------------------------ spawns

  private checkHpTriggers(t: number): void {
    const mode = this.config.boss.practiceMode;
    if (mode === 'zukOnly' || mode === 'sets') return; // no Jad / healers

    if (!this.jadSpawned && this.zuk.hp <= JAD_SPAWN_HP) {
      this.jadSpawned = true;
      this.spawnEntity('jad', t);
    }
    if (!this.healersSpawned && this.zuk.hp <= ENRAGE_HP) {
      this.healersSpawned = true;
      this.enraged = true;
      this.events.push({ tick: t, type: 'enrage' });
      for (let i = 0; i < HEALER_COUNT; i++) this.spawnEntity('healer', t);
    }

    // Wiki `JalTok-Jad`: at half health it spawns its Yt-HurKot healers
    // (three of them on wave 69).
    for (const e of this.entities) {
      if (e.kind !== 'jad' || !e.alive || e.spawnedHealers) continue;
      if (e.hp * 2 > e.maxHp) continue;
      e.spawnedHealers = true;
      for (let i = 0; i < JAD_HEALER_COUNT; i++) {
        const h = this.spawnEntity('jadHealer', t);
        h.healTargetId = e.id;
      }
    }
  }

  private tickSetTimer(t: number): void {
    const mode = this.config.boss.practiceMode;
    if (mode === 'zukOnly' || mode === 'jad' || mode === 'healers') return;

    // First set gates on a full glyph rotation; thereafter on the interval.
    if (!this.firstSetDone) {
      if (this.glyph.rotations >= 1 || this.mods.disableGlyph || this.config.boss.freezeGlyph) {
        this.firstSetDone = true;
        this.spawnSet(t);
        this.setTimer = Math.round(SET_INTERVAL_TICKS * (this.mods.setIntervalMult ?? 1));
      }
      return;
    }

    // Wiki `Inferno`: "a one-time addition of 1:45 minutes is made to the set
    // timer (which is paused between 600 and 480 Hitpoints and is resumed as
    // soon as Jad spawns)".
    if (!this.setPauseBonusApplied && this.zuk.hp <= SET_PAUSE_HP) {
      this.setPauseBonusApplied = true;
      this.setTimer += Math.round(SET_PAUSE_BONUS_TICKS * (this.mods.setIntervalMult ?? 1));
    }
    const paused = this.zuk.hp <= SET_PAUSE_HP && this.zuk.hp > SET_RESUME_HP;
    if (paused) return;

    this.setTimer--;
    if (this.setTimer <= 0) {
      this.spawnSet(t);
      this.setTimer = Math.round(SET_INTERVAL_TICKS * (this.mods.setIntervalMult ?? 1));
    }
  }

  private spawnSet(t: number): void {
    this.spawnEntity('ranger', t);
    this.spawnEntity('mager', t);
  }

  private spawnEntity(kind: EntityKind, t: number): Entity {
    const spec = this.entitySpec(kind);
    const e: Entity = {
      id: this.nextEntityId++,
      kind,
      monster: this.config.addMonsters[kind] ?? null,
      pos: spec.pos,
      size: spec.size,
      hp: spec.hp,
      maxHp: spec.hp,
      alive: true,
      style: spec.style,
      speed: spec.speed,
      maxHit: spec.maxHit,
      nextAttackTick: t + spec.speed,
      windup: null,
      aggro: spec.aggro,
      tagged: false,
      revived: false,
      busyUntil: -1,
      healCounter: 0,
      healTargetId: kind === 'healer' ? 0 : -1,
      spawnedHealers: false,
    };
    this.entities.push(e);
    this.events.push({ tick: t, type: 'addSpawned', entityId: e.id, kind });
    return e;
  }

  private entitySpec(kind: EntityKind): {
    pos: Vec; size: number; hp: number; style: AddStyle | null;
    speed: number; maxHit: number; aggro: Aggro;
  } {
    // Spread spawns along the south edge deterministically. MODELLED — the
    // wiki only says the spawns appear "behind the player".
    const spot = (col: number): Vec => ({ x: 2 + ((col * 5 + this.simRng.int(2)) % (ARENA_W - 4)), y: 1 });
    switch (kind) {
      case 'ranger':
        return { pos: spot(1), size: RANGER_SIZE, hp: RANGER_HP, style: 'ranged', speed: RANGER_SPEED, maxHit: RANGER_MAX_HIT, aggro: 'shield' };
      case 'mager':
        return { pos: spot(3), size: MAGER_SIZE, hp: MAGER_HP, style: 'magic', speed: MAGER_SPEED, maxHit: MAGER_MAX_HIT, aggro: 'shield' };
      case 'jad':
        return { pos: { x: Math.floor(ARENA_W / 2) - 2, y: 4 }, size: JAD_SIZE, hp: JAD_HP, style: 'magic', speed: JAD_SPEED, maxHit: JAD_MAX_HIT, aggro: 'shield' };
      case 'jadHealer':
        // Yt-HurKot heal Jad until tagged, then melee the player.
        return { pos: spot(this.simRng.int(4)), size: 1, hp: JAD_HEALER_HP, style: 'melee', speed: JAD_HEALER_SPEED, maxHit: JAD_HEALER_MAX_HIT, aggro: 'none' };
      case 'healer':
        // Jal-MejJak never attack the shield — they heal Zuk until tagged.
        return { pos: spot(this.simRng.int(4)), size: HEALER_SIZE, hp: HEALER_HP, style: null, speed: HEALER_SPEED, maxHit: HEALER_AOE_MAX, aggro: 'none' };
      default:
        return { pos: { x: 0, y: 0 }, size: 5, hp: 1, style: null, speed: 10, maxHit: 0, aggro: 'none' };
    }
  }

  // ------------------------------------------------------------ adds

  private tickAdds(t: number): void {
    for (const e of this.entities) {
      if (!e.alive || e.kind === 'zuk') continue;

      // Resolve a landing attack.
      if (e.windup && t === e.windup.landTick) {
        this.resolveAddAttack(e, e.windup, t);
        e.windup = null;
      }

      // Jal-MejJak has no targeted attack (handled in tickHealers); an
      // untagged Yt-HurKot is busy healing Jad.
      if (!e.style || e.aggro === 'none') continue;
      if (t < e.nextAttackTick || e.windup || t < e.busyUntil) continue;

      // Wiki `Jal-Zek`: 1/10 chance to revive a fallen monster instead of
      // attacking; it then does nothing for the next seven ticks.
      if (e.kind === 'mager' && this.simRng.chance(MAGER_REVIVE_CHANCE) && this.tryRevive(e, t)) {
        e.busyUntil = t + MAGER_REVIVE_BUSY_TICKS + 1;
        e.nextAttackTick = e.busyUntil;
        continue;
      }

      // Jad picks magic or ranged per attack; everything else has one style.
      const style: AddStyle = e.kind === 'jad' ? (this.simRng.chance(0.5) ? 'magic' : 'ranged') : e.style;
      const delay = e.kind === 'jad' ? JAD_ATTACK_DELAY : ADD_ATTACK_DELAY;
      // A spawn still on the shield can only hit the shield while it stands.
      const target: Aggro = e.aggro === 'shield' && this.shieldStanding() ? 'shield' : 'player';
      e.windup = { style, landTick: t + delay, target };
      e.nextAttackTick = t + e.speed;
      this.events.push({ tick: t, type: 'addAttackDeclared', entityId: e.id, kind: e.kind, style, target, landTick: t + delay });
    }
  }

  private shieldStanding(): boolean {
    return !this.glyphDestroyed && !this.mods.disableGlyph;
  }

  /** Jal-Zek revives one fallen monster from this wave, at half health, near
   *  the centre of the arena. Each monster can only be revived once. */
  private tryRevive(zek: Entity, t: number): boolean {
    for (const dead of this.entities) {
      if (dead.alive || dead.revived || dead.kind === 'zuk' || dead.id === zek.id) continue;
      dead.alive = true;
      dead.revived = true;
      dead.hp = Math.ceil(dead.maxHp / 2);
      dead.pos = { x: Math.floor((ARENA_W - dead.size) / 2), y: Math.floor(ARENA_H / 2) };
      dead.windup = null;
      dead.busyUntil = -1;
      dead.aggro = dead.style ? 'player' : 'none';
      dead.nextAttackTick = t + REVIVED_ATTACK_DELAY;
      this.events.push({ tick: t, type: 'monsterRevived', entityId: dead.id, kind: dead.kind, byId: zek.id });
      return true;
    }
    return false;
  }

  private resolveAddAttack(e: Entity, w: Windup, t: number): void {
    const { style } = w;
    // ---- against the shield -------------------------------------------
    if (w.target === 'shield') {
      if (!this.shieldStanding()) return;
      const dmg = this.simRng.int(e.maxHit);
      this.glyphHp -= dmg;
      this.glyphDamageTaken += dmg;
      this.events.push({
        tick: t, type: 'glyphDamaged', entityId: e.id, kind: e.kind,
        amount: dmg, glyphHpLeft: Math.max(0, this.glyphHp),
      });
      if (this.glyphHp <= 0) {
        this.glyphDestroyed = true;
        this.events.push({ tick: t, type: 'glyphDestroyed' });
      }
      return;
    }

    // ---- against the player -------------------------------------------
    if (this.player.overhead === OVERHEAD_FOR[style]) {
      this.events.push({ tick: t, type: 'addAttack', entityId: e.id, kind: e.kind, style, blocked: true, damage: 0 });
      return;
    }
    const hit = e.monster
      ? this.simRng.next() < normalAccuracy(
        npcAttackRoll(e.monster, DEFENCE_STYLE_FOR[style]),
        playerDefenceRoll(this.defenceInput(), DEFENCE_STYLE_FOR[style]),
      )
      : true;
    const dmg = hit ? this.applyIncomingMult(this.simRng.int(e.maxHit)) : 0;
    this.events.push({ tick: t, type: 'addAttack', entityId: e.id, kind: e.kind, style, blocked: false, damage: dmg });
    const styleName = style === 'magic' ? 'Magic' : style === 'ranged' ? 'Missiles' : 'Melee';
    const hint = e.kind === 'jad'
      ? `pray Protect from ${styleName} on the tick it lands`
      : `keep Protect from ${styleName} up, or kill the ${KIND_LABEL[e.kind]}`;
    this.damagePlayer(dmg, KIND_LABEL[e.kind], hint);
  }

  // ------------------------------------------------------------ healers

  private tickHealers(t: number): void {
    let zukHealed = 0;
    let jadHealed = 0;
    for (const e of this.entities) {
      if (!e.alive) continue;

      // Yt-HurKot: heals Jad until the player tags it.
      if (e.kind === 'jadHealer') {
        if (e.tagged) continue;
        if (++e.healCounter < JAD_HEAL_INTERVAL) continue;
        e.healCounter = 0;
        const jad = this.entities.find((x) => x.id === e.healTargetId);
        if (jad && jad.alive && jad.hp < jad.maxHp) {
          const amt = Math.min(JAD_HEAL_AMOUNT, jad.maxHp - jad.hp);
          jad.hp += amt;
          jadHealed += amt;
        }
        continue;
      }

      if (e.kind !== 'healer') continue;
      if (++e.healCounter < HEALER_HEAL_INTERVAL) continue;
      e.healCounter = 0;

      if (!e.tagged) {
        // Wiki `Jal-MejJak`: heals Zuk 15-24 every three ticks, until attacked.
        if (this.zuk.hp < this.zukMaxHp) {
          const amt = Math.min(
            HEALER_HEAL_MIN + this.simRng.int(HEALER_HEAL_MAX - HEALER_HEAL_MIN),
            this.zukMaxHp - this.zuk.hp,
          );
          this.zuk.hp += amt;
          zukHealed += amt;
        }
      } else {
        // Once struck they stop healing and rain lava balls instead —
        // an AoE that cannot be prayed against, 5-10 per hit.
        const chip = this.applyIncomingMult(HEALER_AOE_MIN + this.simRng.int(HEALER_AOE_MAX - HEALER_AOE_MIN));
        this.damagePlayer(chip, 'Jal-MejJak', 'step out of the lava-ball splash after tagging a healer');
      }
    }
    if (zukHealed > 0) this.events.push({ tick: t, type: 'zukHealed', amount: zukHealed });
    if (jadHealed > 0) this.events.push({ tick: t, type: 'jadHealed', amount: jadHealed });
  }

  // ------------------------------------------------------------ player attack

  private tickPlayerAttack(t: number): void {
    const p = this.player;
    if (!p.alive || this.finished) return;
    if (p.attackDelay > 0 || p.weaponCd > 0) return;

    const target = this.entities.find((e) => e.id === p.targetId && e.alive)
      ?? this.zuk;
    if (!target.alive || !target.monster) return;

    const calc = this.calcFor(target.kind, p.activeGearSet);
    p.weaponCd = calc.weaponSpeedTicks;

    // Attacking a spawn takes its aggression off the shield (wiki: "once
    // attacked, they will instead target the player") and stops a healer.
    this.takeAggro(target, t);

    let accuracy = calc.accuracy;
    let maxHit = calc.maxHit;
    if (!p.offensiveOn) { maxHit = Math.floor(maxHit / 1.23); accuracy /= 1.2; } // Rigour off

    const landed = this.simRng.next() < accuracy;
    const dmg = landed ? this.simRng.int(maxHit) : 0;
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
      this.events.push({ tick: t, type: 'playerHit', targetId: target.id, kind: target.kind, damage: dmg });
      if (target.hp <= 0 && target.kind !== 'zuk') this.killAdd(target, t);
    } else {
      this.events.push({ tick: t, type: 'playerHit', targetId: target.id, kind: target.kind, damage: 0 });
    }
  }

  /** Tagging a spawn: it drops the shield (or its heal target) for you. */
  private takeAggro(e: Entity, t: number): void {
    if (e.kind === 'zuk' || e.tagged) return;
    e.tagged = true;
    if (e.aggro !== 'player') {
      e.aggro = e.style ? 'player' : 'none';
      this.events.push({ tick: t, type: 'aggroTaken', entityId: e.id, kind: e.kind });
    }
  }

  private killAdd(e: Entity, t: number): void {
    e.alive = false;
    e.windup = null;
    this.events.push({ tick: t, type: 'addKilled', entityId: e.id, kind: e.kind });
    // If the player was targeting it, fall back to Zuk.
    if (this.player.targetId === e.id) this.player.targetId = 0;
  }

  // ------------------------------------------------------------ helpers

  /** Refreshed defence-roll input; mutated in place, never retained. */
  private defenceInput(): PlayerDefenceInput {
    const d = this.defInput;
    d.equipment = this.activeEquipment();
    d.rigour = this.player.offensiveOn;
    d.boosts = this.player.boosts;
    return d;
  }

  private applyIncomingMult(dmg: number): number {
    return Math.floor(dmg * (this.mods.incomingDamageMult ?? 1));
  }

  private damagePlayer(amount: number, source: string, correctAction: string): void {
    if (amount <= 0) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.events.push({ tick: this.tickNum, type: 'playerDamaged', source, amount, correctAction });
  }

  private prayerBonus(): number {
    let bonus = 0;
    for (const piece of Object.values(this.activeEquipment())) if (piece) bonus += piece.bonuses.prayer;
    return bonus;
  }

  private activeEquipment(): PlayerLoadout['equipment'] {
    const idx = this.player.activeGearSet;
    if (idx === 0) return this.config.player.loadout.equipment;
    return this.config.player.gearSets[idx - 1]?.equipment ?? this.config.player.loadout.equipment;
  }

  private calcFor(kind: EntityKind, gearSet: number): CalcResult {
    const key = `${kind}:${gearSet}`;
    const cached = this.calcCache.get(key);
    if (cached) return cached;
    const monster = kind === 'zuk' ? this.config.monster : this.config.addMonsters[kind] ?? this.config.monster;
    const equipment = gearSet === 0
      ? this.config.player.loadout.equipment
      : this.config.player.gearSets[gearSet - 1]?.equipment ?? this.config.player.loadout.equipment;
    const loadout: PlayerLoadout = {
      ...this.config.player.loadout,
      skills: this.config.player.skills,
      equipment,
      prayers: { ...this.config.player.loadout.prayers, rigour: true },
    };
    const result = calcDps(loadout, monster);
    this.calcCache.set(key, result);
    return result;
  }

  theoreticalDps(): number {
    return this.calcFor('zuk', 0).dps;
  }

  // ------------------------------------------------------------ input application

  private applyInput(cmd: InputCommand, t: number): void {
    const p = this.player;
    switch (cmd.kind) {
      case 'move':
        if (cmd.to.x >= 0 && cmd.to.x < ARENA_W && cmd.to.y >= 0 && cmd.to.y < ARENA_H) {
          p.moveTarget = { ...cmd.to };
          p.running = cmd.run;
        }
        break;
      case 'pray':
        if (cmd.overhead === null) {
          if (p.overhead !== null) { p.overhead = null; this.events.push({ tick: t, type: 'prayer', overhead: null }); }
        } else if (p.prayer > 0 && p.overhead !== cmd.overhead) {
          p.overhead = cmd.overhead;
          p.overheadOnTick = t;
          this.events.push({ tick: t, type: 'prayer', overhead: cmd.overhead });
        }
        break;
      case 'prayOffensive':
        p.offensiveOn = cmd.on && p.prayer > 0;
        break;
      case 'target':
        p.targetId = cmd.entityId;
        break;
      case 'eat': {
        const r = consume(p, this.config.player.skills, cmd.invIndex, t);
        if (r.ok) this.events.push({ tick: t, type: 'consumed', itemId: r.itemId });
        break;
      }
      case 'switchGear':
        p.activeGearSet = Math.max(0, Math.min(cmd.setIndex, this.config.player.gearSets.length));
        break;
    }
  }

  // ------------------------------------------------------------ snapshot

  private blankSnapshot(): SimSnapshot {
    return {
      tick: 0, playerPos: { x: 0, y: 0 }, playerHp: 0, playerMaxHp: 0,
      playerPrayer: 0, playerMaxPrayer: 0, runEnergy: 0,
      overhead: null, overheadOnTick: -99, offensiveOn: false, targetId: 0,
      playerAlive: true, playerMoveTarget: null, playerRunning: false,
      zukHp: 0, zukMaxHp: 0,
      zukAnchor: { x: 0, y: 0 }, zukSize: ZUK_SIZE,
      zukWindupStartTick: -1, zukWindupLandTick: -1, enraged: false,
      glyphHp: 0, glyphMaxHp: 0, glyphDestroyed: false, glyphSpan: null,
      glyphDir: 1, playerBehindGlyph: false,
      entities: this.entityView, setCountdown: 0,
      pendingInputCount: 0, pendingMoveTarget: null, lastInputLagTicks: -1,
      finished: false,
    };
  }

  getSnapshot(): SimSnapshot { return this.snapshot; }

  /**
   * Refresh the render-facing view. Called once per tick (and once at
   * construction). Everything here is a straight copy of committed engine
   * state — no derivation the renderer could get wrong.
   *
   * The entity views are pooled and updated in place: rebuilding the array
   * with filter/map every tick allocated one object per add per tick, for
   * no benefit to anyone.
   */
  private updateSnapshot(): void {
    const s = this.snapshot as { -readonly [K in keyof SimSnapshot]: SimSnapshot[K] };
    const p = this.player;
    s.tick = this.tickNum;
    s.playerPos = p.pos;
    s.playerHp = p.hp; s.playerMaxHp = p.maxHp;
    s.playerPrayer = p.prayer; s.playerMaxPrayer = p.maxPrayer;
    s.runEnergy = p.runEnergy;
    s.overhead = p.overhead;
    s.overheadOnTick = p.overheadOnTick;
    s.offensiveOn = p.offensiveOn;
    s.targetId = p.targetId;
    s.playerAlive = p.alive;
    s.playerMoveTarget = p.moveTarget;
    s.playerRunning = p.running;

    s.zukHp = this.zuk.hp; s.zukMaxHp = this.zukMaxHp;
    s.zukAnchor = this.zuk.pos; s.zukSize = this.zuk.size;
    s.zukWindupLandTick = this.zuk.windup?.landTick ?? -1;
    s.zukWindupStartTick = this.zuk.windup ? this.zuk.windup.landTick - ZUK_ATTACK_DELAY : -1;
    s.enraged = this.enraged;

    s.glyphHp = Math.max(0, this.glyphHp); s.glyphMaxHp = this.glyphMaxHp;
    s.glyphDestroyed = this.glyphDestroyed;
    s.glyphSpan = this.glyphDestroyed ? null : this.glyph.span();
    s.glyphDir = this.glyph.direction;
    s.playerBehindGlyph = !this.glyphDestroyed && !this.mods.disableGlyph && this.glyph.protects(p.pos);

    let n = 0;
    for (const e of this.entities) {
      if (e.kind === 'zuk' || !e.alive) continue;
      const view = this.entityViewSlot(n++);
      view.id = e.id;
      view.kind = e.kind;
      view.pos = e.pos;
      view.size = e.size;
      view.hp = Math.max(0, e.hp);
      view.maxHp = e.maxHp;
      view.alive = e.alive;
      view.nextAttackTick = e.nextAttackTick;
      view.style = e.style;
      view.aggro = e.aggro;
      view.tagged = e.tagged;
      view.revived = e.revived;
      if (e.windup) {
        view.windup = view.windupSlot;
        view.windupSlot.style = e.windup.style;
        view.windupSlot.landTick = e.windup.landTick;
      } else {
        view.windup = null;
      }
    }
    this.entityView.length = n;
    s.entities = this.entityView;

    s.setCountdown = this.firstSetDone ? Math.max(0, this.setTimer) : -1;

    s.pendingInputCount = this.pending.length;
    let moveTarget: Vec | null = null;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].cmd.kind === 'move') {
        moveTarget = (this.pending[i].cmd as { to: Vec }).to;
        break;
      }
    }
    s.pendingMoveTarget = moveTarget;
    s.lastInputLagTicks = this.lastInputLagTicks;

    s.finished = this.finished;
  }

  /** Grow-once pool of entity views; `length` is trimmed, never rebuilt. */
  private entityViewSlot(i: number): PooledEntityView {
    let v = this.entityView[i];
    if (!v) {
      v = {
        id: 0, kind: 'ranger', pos: { x: 0, y: 0 }, size: 1, hp: 0, maxHp: 0,
        windup: null, alive: true, nextAttackTick: -1, style: null,
        aggro: 'shield', tagged: false, revived: false,
        windupSlot: { style: 'ranged', landTick: -1 },
      };
      this.entityView[i] = v;
    }
    return v;
  }

  /** Test/tooling hook — set Zuk HP and fire any crossed HP triggers. */
  setZukHp(hp: number): void {
    this.zuk.hp = Math.max(0, Math.min(this.zukMaxHp, hp));
    this.checkHpTriggers(this.tickNum);
    if (this.zuk.hp <= 0) this.finish('kill');
  }
}
