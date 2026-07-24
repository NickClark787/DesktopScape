/**
 * The TzKal-Zuk (Inferno wave 69) simulation engine. Headless,
 * deterministic, tick-driven — one `advance()` = 0.6s. Mirrors the Sol
 * Heredit engine's design: two seeded RNG streams (sim + network), a fixed
 * per-tick pipeline, player offense from the shared `calcDps`, replay via
 * re-simulation.
 *
 * The fight is a ranged prayer-switching endurance test rather than a melee
 * dodge: you keep the patrolling Ancestral Glyph between you and Zuk's
 * unpreventable shot, manage Jal-Xil/Jal-Zek add sets and a prayer-switch
 * Jad, then race four healers at enrage.
 */
import { calcDps } from '@engine/formulas';
import type { CalcResult, Monster, PlayerLoadout } from '@shared/types';
import {
  ARENA_H,
  ARENA_W,
  ENRAGE_HP,
  GLYPH_ABSORB_PER_HIT,
  GLYPH_MAX_HP,
  HEALER_AOE_MAX,
  HEALER_AOE_MIN,
  HEALER_COUNT,
  HEALER_HEAL_INTERVAL,
  HEALER_HEAL_MAX,
  HEALER_HEAL_MIN,
  HEALER_HP,
  HEALER_SPEED,
  INFERNO_MODIFIERS,
  JAD_ATTACK_DELAY,
  JAD_HP,
  JAD_MAX_HIT,
  JAD_SPAWN_HP,
  JAD_SPEED,
  MAGER_HP,
  MAGER_MAX_HIT,
  MAGER_REVIVE_DELAY,
  MAGER_SPEED,
  RANGER_HP,
  RANGER_MAX_HIT,
  RANGER_SPEED,
  SET_INTERVAL_TICKS,
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
import { activePrayers, consume, initPlayer, tickMovement, tickPlayerUpkeep, type PlayerState } from './player';
import { makeRng, type Rng } from './rng';
import type {
  AddStyle,
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
  windup: { style: AddStyle; landTick: number } | null;
  reviveAt: number | null;
  healCounter: number;
}

const KIND_LABEL: Record<EntityKind, string> = {
  zuk: 'TzKal-Zuk', ranger: 'Jal-Xil', mager: 'Jal-Zek', jad: 'JalTok-Jad', healer: 'Jal-MejJak',
};

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

  private zuk: Entity;
  zukMaxHp: number;
  enraged = false;

  private mods: ModifierEffects;
  private setTimer: number;
  private firstSetDone = false;
  private jadSpawned = false;
  private healersSpawned = false;

  private calcCache = new Map<string, CalcResult>();
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
      nextAttackTick: ZUK_SPEED, windup: null, reviveAt: null, healCounter: 0,
    };
    this.entities.push(this.zuk);

    this.glyph = new Glyph(0);
    this.glyphMaxHp = this.mods.glyphHp ?? GLYPH_MAX_HP;
    this.glyphHp = this.glyphMaxHp;
    if (this.mods.disableGlyph) this.glyphDestroyed = true;

    this.setTimer = Math.round(SET_INTERVAL_TICKS * (this.mods.setIntervalMult ?? 1));

    this.player = initPlayer(config.player, { x: Math.floor(ARENA_W / 2), y: 2 });

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

    // 8. Healers heal Zuk.
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
      const protectedByGlyph = !this.glyphDestroyed && !this.mods.disableGlyph && this.glyph.protects(this.player.pos);
      if (protectedByGlyph) {
        // Shield absorbs the shot and chips.
        this.glyphHp -= GLYPH_ABSORB_PER_HIT;
        this.events.push({ tick: t, type: 'zukAttack', blocked: true, damage: 0 });
        if (this.glyphHp <= 0) {
          this.glyphDestroyed = true;
          this.events.push({ tick: t, type: 'glyphDestroyed' });
        }
      } else {
        // Unpreventable typeless hit — prayer does NOT help (wiki).
        const dmg = this.applyIncomingMult(this.simRng.int(z.maxHit));
        this.events.push({ tick: t, type: 'zukAttack', blocked: false, damage: dmg });
        this.damagePlayer(dmg, 'TzKal-Zuk', 'stay behind the Ancestral Glyph (move with it)');
      }
      z.windup = null;
    }

    // Declare the next shot.
    if (t >= z.nextAttackTick && !z.windup) {
      const land = t + ZUK_ATTACK_DELAY;
      z.windup = { style: 'ranged', landTick: land };
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

    // Countdown pauses across the 600→480 HP band (wiki: ~1:45 pause).
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
      reviveAt: null,
      healCounter: 0,
    };
    this.entities.push(e);
    this.events.push({ tick: t, type: 'addSpawned', entityId: e.id, kind });
    return e;
  }

  private entitySpec(kind: EntityKind): { pos: Vec; size: number; hp: number; style: AddStyle | null; speed: number; maxHit: number } {
    // Spread spawns along the south edge deterministically.
    const spot = (col: number): Vec => ({ x: 2 + ((col * 5 + this.simRng.int(2)) % (ARENA_W - 4)), y: 1 });
    switch (kind) {
      case 'ranger': return { pos: spot(1), size: 3, hp: RANGER_HP, style: 'ranged', speed: RANGER_SPEED, maxHit: RANGER_MAX_HIT };
      case 'mager': return { pos: spot(3), size: 3, hp: MAGER_HP, style: 'magic', speed: MAGER_SPEED, maxHit: MAGER_MAX_HIT };
      case 'jad': return { pos: { x: Math.floor(ARENA_W / 2) - 2, y: 4 }, size: 5, hp: JAD_HP, style: 'magic', speed: JAD_SPEED, maxHit: JAD_MAX_HIT };
      case 'healer': return { pos: spot(this.simRng.int(4)), size: 2, hp: HEALER_HP, style: null, speed: HEALER_SPEED, maxHit: HEALER_AOE_MAX };
      default: return { pos: { x: 0, y: 0 }, size: 5, hp: 1, style: null, speed: 10, maxHit: 0 };
    }
  }

  // ------------------------------------------------------------ adds

  private tickAdds(t: number): void {
    for (const e of this.entities) {
      if (!e.alive || e.kind === 'zuk') continue;

      // Mager revive.
      if (e.reviveAt !== null && t >= e.reviveAt) {
        e.alive = true;
        e.hp = Math.ceil(e.maxHp / 2);
        e.reviveAt = null;
        this.events.push({ tick: t, type: 'magerRevived', entityId: e.id });
      }

      // Resolve a landing attack.
      if (e.windup && t === e.windup.landTick) {
        this.resolveAddAttack(e, e.windup.style, t);
        e.windup = null;
      }
      // Declare the next attack (healers use an AoE via style null → handled in tickHealers).
      if (e.style && t >= e.nextAttackTick && !e.windup) {
        // Jad alternates styles unpredictably; other adds have a fixed style.
        const style: AddStyle = e.kind === 'jad' ? (this.simRng.chance(0.5) ? 'magic' : 'ranged') : e.style;
        const delay = e.kind === 'jad' ? JAD_ATTACK_DELAY : 2;
        e.windup = { style, landTick: t + delay };
        e.nextAttackTick = t + e.speed;
        this.events.push({ tick: t, type: 'addAttackDeclared', entityId: e.id, kind: e.kind, style, landTick: t + delay });
      }
    }
  }

  private resolveAddAttack(e: Entity, style: AddStyle, t: number): void {
    const overheadFor: Record<AddStyle, Overhead> = { ranged: 'ranged', magic: 'magic' };
    const blocked = this.player.overhead === overheadFor[style];
    if (blocked) {
      this.events.push({ tick: t, type: 'addAttack', entityId: e.id, kind: e.kind, style, blocked: true, damage: 0 });
      return;
    }
    const dmg = this.applyIncomingMult(this.simRng.int(e.maxHit));
    this.events.push({ tick: t, type: 'addAttack', entityId: e.id, kind: e.kind, style, blocked: false, damage: dmg });
    const hint = e.kind === 'jad'
      ? `pray Protect from ${style === 'magic' ? 'Magic' : 'Missiles'} on the tick it lands`
      : `keep Protect from ${style === 'magic' ? 'Magic' : 'Missiles'} up, or kill the ${KIND_LABEL[e.kind]}`;
    this.damagePlayer(dmg, KIND_LABEL[e.kind], hint);
  }

  // ------------------------------------------------------------ healers

  private tickHealers(t: number): void {
    let healed = 0;
    for (const e of this.entities) {
      if (!e.alive || e.kind !== 'healer') continue;
      e.healCounter++;
      if (e.healCounter >= HEALER_HEAL_INTERVAL) {
        e.healCounter = 0;
        if (this.zuk.hp < this.zukMaxHp) {
          const amt = HEALER_HEAL_MIN + this.simRng.int(HEALER_HEAL_MAX - HEALER_HEAL_MIN);
          this.zuk.hp = Math.min(this.zukMaxHp, this.zuk.hp + amt);
          healed += amt;
        }
        // Small AoE chip on the player.
        const chip = this.applyIncomingMult(HEALER_AOE_MIN + this.simRng.int(HEALER_AOE_MAX - HEALER_AOE_MIN));
        this.damagePlayer(chip, 'Jal-MejJak', 'kill the healers fast — they heal Zuk');
      }
    }
    if (healed > 0) this.events.push({ tick: t, type: 'zukHealed', amount: healed });
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

  private killAdd(e: Entity, t: number): void {
    e.alive = false;
    this.events.push({ tick: t, type: 'addKilled', entityId: e.id, kind: e.kind });
    // Jal-Zek resurrects once.
    if (e.kind === 'mager' && e.reviveAt === null && this.config.boss.practiceMode !== 'zukOnly') {
      e.reviveAt = t + MAGER_REVIVE_DELAY;
    }
    // If the player was targeting it, fall back to Zuk.
    if (this.player.targetId === e.id) this.player.targetId = 0;
  }

  // ------------------------------------------------------------ helpers

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
      overhead: null, offensiveOn: false, targetId: 0,
      zukHp: 0, zukMaxHp: 0, zukWindupLandTick: -1, enraged: false,
      glyphHp: 0, glyphMaxHp: 0, glyphDestroyed: false, glyphSpan: null,
      playerBehindGlyph: false, entities: [], setCountdown: 0, finished: false,
    };
  }

  getSnapshot(): SimSnapshot { return this.snapshot; }

  private updateSnapshot(): void {
    const s = this.snapshot;
    const p = this.player;
    s.tick = this.tickNum;
    s.playerPos = p.pos;
    s.playerHp = p.hp; s.playerMaxHp = p.maxHp;
    s.playerPrayer = p.prayer; s.playerMaxPrayer = p.maxPrayer;
    s.runEnergy = p.runEnergy;
    s.overhead = p.overhead; s.offensiveOn = p.offensiveOn; s.targetId = p.targetId;
    s.zukHp = this.zuk.hp; s.zukMaxHp = this.zukMaxHp;
    s.zukWindupLandTick = this.zuk.windup?.landTick ?? -1;
    s.enraged = this.enraged;
    s.glyphHp = Math.max(0, this.glyphHp); s.glyphMaxHp = this.glyphMaxHp;
    s.glyphDestroyed = this.glyphDestroyed;
    s.glyphSpan = this.glyphDestroyed ? null : this.glyph.span();
    s.playerBehindGlyph = !this.glyphDestroyed && !this.mods.disableGlyph && this.glyph.protects(p.pos);
    s.entities = this.entities
      .filter((e) => e.alive || e.reviveAt !== null)
      .map((e) => ({
        id: e.id, kind: e.kind, pos: e.pos, size: e.size,
        hp: Math.max(0, e.hp), maxHp: e.maxHp,
        windup: e.windup ? { style: e.windup.style, landTick: e.windup.landTick } : null,
      }));
    s.setCountdown = this.firstSetDone ? Math.max(0, this.setTimer) : -1;
    s.finished = this.finished;
  }

  /** Test/tooling hook — set Zuk HP and fire any crossed HP triggers. */
  setZukHp(hp: number): void {
    this.zuk.hp = Math.max(0, Math.min(this.zukMaxHp, hp));
    this.checkHpTriggers(this.tickNum);
    if (this.zuk.hp <= 0) this.finish('kill');
  }
}
