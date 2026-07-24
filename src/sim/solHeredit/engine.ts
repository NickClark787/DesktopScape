/**
 * The Sol Heredit simulation engine. Headless, deterministic, tick-driven:
 * one call to `tick()` advances 0.6s of game time. All timing is expressed
 * in ticks. Two independent RNG streams keep replays exact:
 *
 *  - `simRng`  — consumed only inside `tick()`, in a fixed order.
 *  - `netRng`  — consumed once per queued input (latency jitter/loss), in
 *    input order, which the replay file preserves.
 *
 * Player offense comes from the app's shared combat calc (`calcDps`), so
 * gear/prayer/potion math stays identical to the optimizer's.
 */
import { calcDps } from '@engine/formulas';
import type { CalcResult, Monster, PlayerLoadout } from '@shared/types';
import { AttackScript } from './attackPattern';
import {
  AOE_MAX_HIT,
  AOE_RESOLVE_DELAY,
  ARENA_H,
  ARENA_W,
  BEAM_FIRE_DELAY,
  BEAM_MAX_HIT,
  BEAM_SAND_DELAY,
  BEAM_SMITE_DIVISOR,
  COLOSSEUM_MODIFIERS,
  ENRAGE_HP_GATE,
  ENRAGE_SAND_INTERVAL,
  GRAPPLE_MAX_HIT,
  GRAPPLE_PERFECT_BUFF_TICKS,
  GRAPPLE_WINDOW,
  MELEE_RANGE,
  PHASE_THRESHOLDS,
  SHIELD_SPEED,
  SPEAR_SPEED,
  SPEEDUP_AFTER_TRANSITION,
  TICK_MS,
  TRANSITION_BEAM_AREA,
  TRANSITION_BEAM_COUNT,
  TRANSITION_PAUSE,
  TRIPLE_FIRST_OFFSET,
  TRIPLE_GAP,
  TRIPLE_SLOW_GATE,
  TRIPLE_THIRD_GAP_SLOW,
  TRIPLE_VARIANT1_MAX,
  TRIPLE_VARIANT2_MAX,
} from './constants';
import { aoeHazardTiles, distToBoss, inArena, tileKey, underBoss } from './hazards';
import {
  activePrayers,
  consume,
  initPlayer,
  tickMovement,
  tickPlayerUpkeep,
  type PlayerState,
} from './player';
import { makeRng, type Rng } from './rng';
import type {
  AoeAttack,
  BossAttack,
  GrappleSlot,
  InputCommand,
  ModifierEffects,
  SimConfig,
  SimEvent,
  SimSnapshot,
  TimedInput,
  Vec,
} from './types';

/** Standing on molten sand hurts (approximation — the wiki describes sand
 *  as area denial; a small per-tick bite forces the same behavior). */
const SAND_TICK_DAMAGE = 4;

const GRAPPLE_SLOTS: GrappleSlot[] = ['head', 'body', 'legs', 'weapon', 'shield'];

const DODGE_HINT: Record<AoeAttack, string> = {
  spear1: 'step 1 tile back from his centre tile or a corner tile',
  spear2: 'step 1 tile back diagonally, onto an off-centre line',
  shield1: 'step 1 tile back out of melee range (9x9 safe ring)',
  shield2: 'step 2 tiles back (11x11 safe ring)',
};

interface PendingInput {
  cmd: InputCommand;
  effectTick: number;
  seq: number;
}

interface CurrentAttack {
  attack: BossAttack;
  declareTick: number;
  /** AoE: the single resolve tick. Triple: unused. Grapple: window end. */
  resolveTick: number;
  hazard: Set<string> | null;
  tripleHitTicks: number[];
  tripleMaxes: readonly number[];
  grappleSlot: GrappleSlot | null;
  grappleParried: boolean;
  grapplePerfect: boolean;
}

export class SolHereditSim {
  readonly config: SimConfig;
  readonly events: SimEvent[] = [];
  readonly inputLog: TimedInput[] = [];

  private simRng: Rng;
  private netRng: Rng;
  private tickNum = 0;
  private inputSeq = 0;
  private pending: PendingInput[] = [];

  player: PlayerState;
  bossAnchor: Vec;
  bossHp: number;
  bossMaxHp: number;

  private script: AttackScript;
  private current: CurrentAttack | null = null;
  private nextAttackTick: number;
  private afterTransition = false;
  private transitionEndTick = -1;
  private spedUp = false;
  private pendingThresholds: number[];
  private guaranteedMaxUntil = -1;
  private singlePhaseFloor = 0;

  private sand = new Set<string>();
  private beams: { pos: Vec; sandTick: number; fireTick: number; done: boolean }[] = [];

  private calcCache: CalcResult[] = [];
  private mods: ModifierEffects;
  finished = false;
  outcome: 'kill' | 'death' | 'timeout' | null = null;

  private snapshot: SimSnapshot;

  constructor(config: SimConfig) {
    this.config = config;
    this.simRng = makeRng(config.seed >>> 0);
    this.netRng = makeRng((config.seed ^ 0x9e3779b9) >>> 0);

    // Merge active modifier effects (declarative list in constants).
    this.mods = {};
    for (const id of config.boss.modifierIds) {
      const m = COLOSSEUM_MODIFIERS.find((x) => x.id === id);
      if (!m) continue;
      this.mods = {
        aoeDamageMult: (this.mods.aoeDamageMult ?? 1) * (m.effects.aoeDamageMult ?? 1),
        prayerDrainMult: (this.mods.prayerDrainMult ?? 1) * (m.effects.prayerDrainMult ?? 1),
        playerDefenceMult: (this.mods.playerDefenceMult ?? 1) * (m.effects.playerDefenceMult ?? 1),
        bossMaxHitAdd: (this.mods.bossMaxHitAdd ?? 0) + (m.effects.bossMaxHitAdd ?? 0),
      };
    }

    // Boss centred against the north wall; player spawns south of him.
    this.bossAnchor = { x: Math.floor((ARENA_W - 5) / 2), y: ARENA_H - 6 };
    this.bossMaxHp = config.monster.skills.hp;
    let startFrac = Math.max(1, Math.min(100, config.boss.startHpPct)) / 100;
    if (config.boss.practiceMode === 'singlePhase') {
      const tops = [1, ...PHASE_THRESHOLDS];
      const idx = Math.max(0, Math.min(config.boss.practicePhase, PHASE_THRESHOLDS.length));
      startFrac = tops[idx];
      this.singlePhaseFloor = idx < PHASE_THRESHOLDS.length ? PHASE_THRESHOLDS[idx] : 0;
    }
    this.bossHp = Math.ceil(this.bossMaxHp * startFrac);
    this.pendingThresholds = PHASE_THRESHOLDS
      .filter((t) => config.boss.enabledTransitions.includes(t) && t < startFrac)
      .sort((a, b) => b - a);

    this.player = initPlayer(config.player, { x: Math.floor(ARENA_W / 2), y: 4 });

    // Pre-compute the shared-calc offense for every gear set once.
    const sets: PlayerLoadout[] = [config.player.loadout, ...config.player.gearSets.map((g) => ({
      ...config.player.loadout,
      equipment: g.equipment,
    }))];
    this.calcCache = sets.map((l) => calcDps(this.offensiveLoadout(l), config.monster));

    this.script = new AttackScript(config.boss);
    this.nextAttackTick = 1;
    this.snapshot = this.makeSnapshot();
  }

  /** The loadout as the shared calc should see it: the style-appropriate
   *  offensive prayer is priced in (prayerMultipliers picks the one that
   *  matters for the loadout's style); the sim scales the hit back down on
   *  ticks where the prayer is actually off. */
  private offensiveLoadout(l: PlayerLoadout): PlayerLoadout {
    return {
      ...l,
      skills: this.config.player.skills,
      prayers: { ...l.prayers, piety: true, rigour: true, augury: true },
    };
  }

  // ------------------------------------------------------------ inputs

  /**
   * Queue an input issued client-side during `clientTick`, `msIntoTick` ms
   * after the tick boundary. Latency (ping ± jitter) shifts its arrival;
   * inputs take effect at the START of the first tick after arrival —
   * exactly how OSRS processes clicks, which is why ping matters.
   */
  queueInput(input: TimedInput): void {
    this.inputLog.push(input);
    const { pingMs, jitterMs, packetLossPct } = this.config.latency;
    const jitter = jitterMs > 0 ? (this.netRng.next() * 2 - 1) * jitterMs : 0;
    const lost = packetLossPct > 0 && this.netRng.chance(packetLossPct / 100);
    if (lost) {
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
    const p = this.player;

    // 1. Apply inputs that have arrived.
    this.pending.sort((a, b) => a.effectTick - b.effectTick || a.seq - b.seq);
    while (this.pending.length && this.pending[0].effectTick <= t) {
      this.applyInput(this.pending.shift()!.cmd, t);
    }

    // 2. Player upkeep + movement.
    const prayerBonus = this.prayerBonus();
    tickPlayerUpkeep(p, t, prayerBonus, this.mods.prayerDrainMult ?? 1);
    tickMovement(p, this.bossAnchor, this.sand);
    if (this.sand.has(tileKey(p.pos.x, p.pos.y))) {
      this.damagePlayer(SAND_TICK_DAMAGE, 'Molten sand', true, 'step off the molten sand');
    }

    // 3. Transition machinery (beams → sand → spheres).
    for (const b of this.beams) {
      if (t === b.sandTick) this.sand.add(tileKey(b.pos.x, b.pos.y));
      if (t === b.fireTick && !b.done) {
        b.done = true;
        if (p.pos.x === b.pos.x && p.pos.y === b.pos.y) {
          const dmg = this.rollBossDamage(BEAM_MAX_HIT);
          const drained = Math.floor(dmg / BEAM_SMITE_DIVISOR);
          p.prayer = Math.max(0, p.prayer - drained);
          if (p.prayer === 0) { p.protectMelee = false; p.offensiveOn = false; }
          this.events.push({ tick: t, type: 'beamHit', damage: dmg, prayerDrained: drained });
          this.damagePlayer(dmg, 'Light beam', true, 'move off the beam tile before it fires');
        }
      }
    }

    // 4. Enrage sand.
    if (this.bossHp / this.bossMaxHp < ENRAGE_HP_GATE && t % ENRAGE_SAND_INTERVAL === 0) {
      this.spawnRandomSand();
    }

    // 5. Boss attack script.
    this.tickBoss(t);

    // 6. Player auto-attack.
    this.tickPlayerAttack(t);

    // 7. End conditions.
    if (p.hp <= 0 && p.alive) {
      p.alive = false;
      this.events.push({ tick: t, type: 'death' });
      this.finish('death');
    }
    if (this.config.boss.practiceMode === 'singlePhase'
      && this.bossHp / this.bossMaxHp <= this.singlePhaseFloor && !this.finished) {
      this.finish('kill');
    }

    this.updateSnapshot();
  }

  private finish(outcome: 'kill' | 'death' | 'timeout'): void {
    this.finished = true;
    this.outcome = outcome;
    if (outcome === 'kill') this.events.push({ tick: this.tickNum, type: 'bossKilled' });
  }

  // ------------------------------------------------------------ boss

  private attackSpeed(attack: BossAttack): number {
    const base = attack === 'shield1' || attack === 'shield2' ? SHIELD_SPEED : SPEAR_SPEED;
    return this.spedUp ? base - 1 : base;
  }

  private tickBoss(t: number): void {
    // Paused during a transition window.
    if (t < this.transitionEndTick) return;

    const cur = this.current;
    if (cur) {
      if (cur.attack === 'tripleParry') this.resolveTripleHits(cur, t);
      else if (cur.attack === 'grapple') this.resolveGrapple(cur, t);
      else this.resolveAoe(cur, t);
    }

    if (t >= this.nextAttackTick && !this.finished) {
      this.declareAttack(t);
    }
  }

  private declareAttack(t: number): void {
    const hpFrac = this.bossHp / this.bossMaxHp;
    const attack = this.script.next(this.simRng, hpFrac, this.afterTransition);
    this.afterTransition = false;

    const cur: CurrentAttack = {
      attack,
      declareTick: t,
      resolveTick: t + AOE_RESOLVE_DELAY,
      hazard: null,
      tripleHitTicks: [],
      tripleMaxes: TRIPLE_VARIANT1_MAX,
      grappleSlot: null,
      grappleParried: false,
      grapplePerfect: false,
    };

    if (attack === 'tripleParry') {
      const slow = hpFrac < TRIPLE_SLOW_GATE;
      const h1 = t + TRIPLE_FIRST_OFFSET;
      const h2 = h1 + TRIPLE_GAP;
      const h3 = h2 + (slow ? TRIPLE_THIRD_GAP_SLOW : TRIPLE_GAP);
      cur.tripleHitTicks = [h1, h2, h3];
      cur.tripleMaxes = slow ? TRIPLE_VARIANT2_MAX : TRIPLE_VARIANT1_MAX;
      this.nextAttackTick = h3 + this.attackSpeed('spear1');
    } else if (attack === 'grapple') {
      cur.grappleSlot = GRAPPLE_SLOTS[this.simRng.int(GRAPPLE_SLOTS.length - 1)];
      cur.resolveTick = t + GRAPPLE_WINDOW;
      // Cadence runs from the declaration (like the AoEs), which is what
      // makes a perfect parry meaningful: the next attack resolves at
      // t+speed+1, inside the resolve+5 guaranteed-max window.
      this.nextAttackTick = t + this.attackSpeed('spear1');
    } else {
      cur.hazard = aoeHazardTiles(attack, this.bossAnchor, this.player.pos);
      this.nextAttackTick = t + this.attackSpeed(attack);
    }

    this.current = cur;
    this.events.push({
      tick: t, type: 'bossAttackDeclared', attack,
      resolveTick: cur.attack === 'tripleParry' ? cur.tripleHitTicks[0] : cur.resolveTick,
      grappleSlot: cur.grappleSlot ?? undefined,
    });
  }

  private resolveAoe(cur: CurrentAttack, t: number): void {
    if (t !== cur.resolveTick || !cur.hazard) return;
    const attack = cur.attack as AoeAttack;
    const onHazard = cur.hazard.has(tileKey(this.player.pos.x, this.player.pos.y));
    if (onHazard) {
      // Typeless — Protect from Melee does not reduce it (wiki).
      this.damagePlayer(this.rollBossDamage(AOE_MAX_HIT), attack, true, DODGE_HINT[attack]);
    } else {
      this.events.push({ tick: t, type: 'playerDodged', attack });
    }
    this.current = null;
  }

  private resolveTripleHits(cur: CurrentAttack, t: number): void {
    const idx = cur.tripleHitTicks.indexOf(t);
    if (idx === -1) {
      if (t > cur.tripleHitTicks[2]) this.current = null;
      return;
    }
    const p = this.player;
    // Block rule: Protect from Melee must be ACTIVE and have been switched
    // on EXACTLY the tick before this hit. Earlier activation (including
    // "already on when the sequence started") fails the block; so does
    // being off. This also forces a re-flick between the three hits.
    const blocked = p.protectMelee && p.protectMeleeOnTick === t - 1;
    if (blocked) {
      this.events.push({ tick: t, type: 'parryBlocked', hitIndex: idx });
    } else {
      const reason = !p.protectMelee
        ? 'Protect from Melee was not active'
        : p.protectMeleeOnTick < t - 1
          ? 'prayed too early — activate on the tick before the hit'
          : 'prayed too late';
      this.events.push({ tick: t, type: 'parryFailed', hitIndex: idx, reason });
      this.damagePlayer(
        this.rollBossDamage(cur.tripleMaxes[idx]),
        `Triple Parry hit ${idx + 1}`,
        true,
        `flick Protect from Melee ON at tick ${t - 1} (${reason})`,
      );
    }
    if (idx === 2) this.current = null;
  }

  private resolveGrapple(cur: CurrentAttack, t: number): void {
    if (t < cur.resolveTick) return;
    if (cur.grappleParried) {
      this.events.push({ tick: t, type: 'grappleParried', perfect: cur.grapplePerfect });
      if (cur.grapplePerfect) this.guaranteedMaxUntil = t + GRAPPLE_PERFECT_BUFF_TICKS;
    } else {
      this.events.push({ tick: t, type: 'grappleFailed', reason: 'no parry within 4 ticks' });
      this.damagePlayer(
        this.rollBossDamage(GRAPPLE_MAX_HIT),
        'Grapple',
        true,
        `click your ${cur.grappleSlot} item within ${GRAPPLE_WINDOW} ticks`,
      );
    }
    this.current = null;
  }

  private handleTransitions(t: number): void {
    const frac = this.bossHp / this.bossMaxHp;
    while (this.pendingThresholds.length && frac <= this.pendingThresholds[0]) {
      const threshold = this.pendingThresholds.shift()!;
      this.events.push({ tick: t, type: 'phaseTransition', hpFrac: threshold });
      this.transitionEndTick = t + TRANSITION_PAUSE;
      this.nextAttackTick = this.transitionEndTick;
      this.afterTransition = true;
      this.current = null; // the transition interrupts his current attack
      if (threshold <= SPEEDUP_AFTER_TRANSITION) this.spedUp = true;
      this.spawnBeams(t);
    }
  }

  private spawnBeams(t: number): void {
    const half = Math.floor(TRANSITION_BEAM_AREA / 2);
    const px = this.player.pos.x;
    const py = this.player.pos.y;
    const chosen = new Set<string>();
    let guard = 0;
    while (chosen.size < TRANSITION_BEAM_COUNT && guard++ < 200) {
      const x = px - half + this.simRng.int(TRANSITION_BEAM_AREA - 1);
      const y = py - half + this.simRng.int(TRANSITION_BEAM_AREA - 1);
      if (!inArena(x, y) || underBoss(this.bossAnchor, x, y)) continue;
      const k = tileKey(x, y);
      if (chosen.has(k)) continue;
      chosen.add(k);
      this.beams.push({ pos: { x, y }, sandTick: t + BEAM_SAND_DELAY, fireTick: t + BEAM_FIRE_DELAY, done: false });
    }
  }

  private spawnRandomSand(): void {
    let guard = 0;
    while (guard++ < 50) {
      const x = this.simRng.int(ARENA_W - 1);
      const y = this.simRng.int(ARENA_H - 1);
      if (underBoss(this.bossAnchor, x, y)) continue;
      if (x === this.player.pos.x && y === this.player.pos.y) continue;
      const k = tileKey(x, y);
      if (this.sand.has(k)) continue;
      this.sand.add(k);
      return;
    }
  }

  // ------------------------------------------------------------ combat

  private rollBossDamage(maxHit: number): number {
    const buffed = this.tickNum <= this.guaranteedMaxUntil;
    const max = maxHit + (this.mods.bossMaxHitAdd ?? 0);
    const base = buffed ? max : this.simRng.int(max);
    return Math.floor(base * (this.mods.aoeDamageMult ?? 1));
  }

  private damagePlayer(amount: number, source: string, avoidable: boolean, correctAction?: string): void {
    if (amount <= 0 && !avoidable) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.events.push({ tick: this.tickNum, type: 'playerDamaged', source, amount, avoidable, correctAction });
  }

  private tickPlayerAttack(t: number): void {
    const p = this.player;
    if (!p.alive || this.finished) return;
    if (p.attackDelay > 0 || p.weaponCd > 0 || p.moveTarget) return;
    if (distToBoss(this.bossAnchor, p.pos.x, p.pos.y) > MELEE_RANGE) return;

    const calc = this.calcCache[p.activeGearSet] ?? this.calcCache[0];
    let accuracy = calc.accuracy;
    let maxHit = calc.maxHit;
    let spec = false;

    if (p.specArmed) {
      const setLoadout = p.activeGearSet === 0
        ? this.config.player.loadout
        : { ...this.config.player.loadout, equipment: this.config.player.gearSets[p.activeGearSet - 1]?.equipment ?? {} };
      const weaponName = setLoadout.equipment.weapon?.name ?? '';
      const def = this.config.player.specs.find((s) => s.weaponName === weaponName);
      if (def && p.specEnergy >= def.energyCost) {
        p.specEnergy -= def.energyCost;
        accuracy = Math.min(1, accuracy * def.accuracyMult);
        maxHit = Math.floor(maxHit * def.damageMult);
        spec = true;
      }
      p.specArmed = false;
    }

    // The offensive prayer is priced into the cached calc; if it's off,
    // scale the hit back down (approximation: piety ≈ +23% dmg, +20% acc).
    if (!p.offensiveOn) {
      maxHit = Math.floor(maxHit / 1.23);
      accuracy = accuracy / 1.2;
    }

    p.weaponCd = calc.weaponSpeedTicks;
    const landed = this.simRng.next() < accuracy;
    const dmg = landed ? this.simRng.int(maxHit) : 0;
    if (dmg > 0 && !this.config.boss.infiniteHp) {
      this.bossHp = Math.max(0, this.bossHp - dmg);
    }
    this.events.push({ tick: t, type: 'playerHitBoss', damage: dmg, spec });

    if (this.bossHp <= 0) {
      this.finish('kill');
      return;
    }
    this.handleTransitions(t);
  }

  private prayerBonus(): number {
    const eq = this.activeEquipment();
    let bonus = 0;
    for (const piece of Object.values(eq)) if (piece) bonus += piece.bonuses.prayer;
    return bonus;
  }

  private activeEquipment(): PlayerLoadout['equipment'] {
    const idx = this.player.activeGearSet;
    if (idx === 0) return this.config.player.loadout.equipment;
    return this.config.player.gearSets[idx - 1]?.equipment ?? this.config.player.loadout.equipment;
  }

  // ------------------------------------------------------------ input application

  private applyInput(cmd: InputCommand, t: number): void {
    const p = this.player;
    switch (cmd.kind) {
      case 'move': {
        if (inArena(cmd.to.x, cmd.to.y)) {
          p.moveTarget = { ...cmd.to };
          p.running = cmd.run;
        }
        break;
      }
      case 'pray': {
        if (cmd.prayer === 'protectMelee') {
          if (cmd.on && !p.protectMelee && p.prayer > 0) {
            p.protectMelee = true;
            p.protectMeleeOnTick = t;
            this.events.push({ tick: t, type: 'prayer', prayer: 'protectMelee', on: true });
          } else if (!cmd.on && p.protectMelee) {
            p.protectMelee = false;
            this.events.push({ tick: t, type: 'prayer', prayer: 'protectMelee', on: false });
          }
        } else {
          const next = cmd.on && p.prayer > 0;
          if (next !== p.offensiveOn) {
            p.offensiveOn = next;
            this.events.push({ tick: t, type: 'prayer', prayer: p.offensivePrayer, on: next });
          }
        }
        break;
      }
      case 'eat': {
        const r = consume(p, this.config.player, cmd.invIndex, t);
        if (r.ok) this.events.push({ tick: t, type: 'consumed', itemId: r.itemId });
        break;
      }
      case 'switchGear': {
        const max = this.config.player.gearSets.length;
        p.activeGearSet = Math.max(0, Math.min(cmd.setIndex, max));
        break;
      }
      case 'spec': {
        p.specArmed = true;
        break;
      }
      case 'parry': {
        const cur = this.current;
        if (cur && cur.attack === 'grapple' && !cur.grappleParried
          && t > cur.declareTick && t <= cur.resolveTick
          && cmd.slot === cur.grappleSlot) {
          cur.grappleParried = true;
          cur.grapplePerfect = t === cur.resolveTick; // last possible tick
        }
        break;
      }
      case 'attackBoss': {
        p.moveTarget = null;
        break;
      }
    }
  }

  // ------------------------------------------------------------ snapshot

  private makeSnapshot(): SimSnapshot {
    return {
      tick: 0,
      playerPos: { x: 0, y: 0 },
      playerHp: 0, playerMaxHp: 0, playerPrayer: 0, playerMaxPrayer: 0,
      runEnergy: 0, specEnergy: 0,
      activePrayers: [],
      bossAnchor: { x: 0, y: 0 },
      bossHp: 0, bossMaxHp: 0,
      bossAttack: null, bossAttackResolveTick: -1, grappleSlot: null,
      hazardTiles: new Set(), sandTiles: this.sand, beams: [],
      nextAttackHint: null, activeGearSet: 0, finished: false,
    };
  }

  /** Mutated in place each tick — the render loop must not retain it. */
  getSnapshot(): SimSnapshot {
    return this.snapshot;
  }

  private updateSnapshot(): void {
    const s = this.snapshot as {
      -readonly [K in keyof SimSnapshot]: SimSnapshot[K];
    };
    const p = this.player;
    s.tick = this.tickNum;
    s.playerPos.x = p.pos.x; s.playerPos.y = p.pos.y;
    s.playerHp = p.hp; s.playerMaxHp = p.maxHp;
    s.playerPrayer = p.prayer; s.playerMaxPrayer = p.maxPrayer;
    s.runEnergy = p.runEnergy; s.specEnergy = p.specEnergy;
    s.activePrayers = activePrayers(p);
    s.bossAnchor = this.bossAnchor;
    s.bossHp = this.bossHp; s.bossMaxHp = this.bossMaxHp;
    s.bossAttack = this.current?.attack ?? null;
    s.bossAttackResolveTick = this.current
      ? (this.current.attack === 'tripleParry'
        ? this.current.tripleHitTicks.find((h) => h > this.tickNum) ?? -1
        : this.current.resolveTick)
      : -1;
    s.grappleSlot = this.current?.grappleSlot ?? null;
    s.hazardTiles = this.current?.hazard ?? EMPTY_SET;
    s.sandTiles = this.sand;
    s.beams = this.beams.filter((b) => !b.done);
    s.nextAttackHint = null;
    s.activeGearSet = p.activeGearSet;
    s.finished = this.finished;
  }

  /** Theoretical DPS of the main gear set (shared calc). */
  theoreticalDps(): number {
    return this.calcCache[0]?.dps ?? 0;
  }

  /**
   * Set boss HP directly and process any crossed phase thresholds — used
   * by tests and by practice tooling; NOT part of normal simulation flow.
   */
  setBossHp(hp: number): void {
    this.bossHp = Math.max(0, Math.min(this.bossMaxHp, hp));
    this.handleTransitions(this.tickNum);
    if (this.bossHp <= 0) this.finish('kill');
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();
