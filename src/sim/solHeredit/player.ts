/**
 * Player model: tick-accurate stats/boosts, prayer (with flicking), food
 * and potion timing, movement with run energy, gear sets, spec energy.
 * Pure state + transition functions — the engine drives it.
 */
import type { PlayerSkills } from '@shared/types';
import { tickPrayerDrain, type PrayerDrainState, type PrayerId } from '@engine/prayerDrain';
import {
  BOOST_DECAY_INTERVAL,
  CONSUMABLE_INDEX,
  EAT_COOLDOWN,
  KARAMBWAN_COOLDOWN,
  POTION_COOLDOWN,
  RUN_DRAIN_PER_TILE,
  RUN_REGEN_PER_TICK,
  SPEC_REGEN_TICKS_PER_10,
} from './constants';
import { inArena, tileKey, underBoss } from './hazards';
import type { PlayerConfig, Vec } from './types';

export type OffensivePrayer = 'piety' | 'rigour' | 'augury';

export interface PlayerState {
  pos: Vec;
  moveTarget: Vec | null;
  running: boolean;
  runEnergy: number; // 0..100
  hp: number;
  maxHp: number;
  prayer: number;
  maxPrayer: number;
  boosts: Record<keyof PlayerSkills, number>;
  divineUntil: number; // tick until which divine re-pins boosts
  divineBoosts: Partial<Record<keyof PlayerSkills, number>> | null;
  protectMelee: boolean;
  /** Tick protect-melee last transitioned OFF→ON — parry timing checks it. */
  protectMeleeOnTick: number;
  offensivePrayer: OffensivePrayer;
  offensiveOn: boolean;
  drain: PrayerDrainState;
  foodCd: number;
  potionCd: number;
  karambwanCd: number;
  /** Extra ticks before the next attack (eat delays, switches land here). */
  attackDelay: number;
  weaponCd: number;
  specEnergy: number; // 0..100
  specRegenCounter: number;
  specArmed: boolean;
  activeGearSet: number; // 0 = main loadout, 1.. = config.gearSets[i-1]
  inventory: { itemId: string | null; qty: number }[];
  alive: boolean;
}

export function initPlayer(cfg: PlayerConfig, spawn: Vec): PlayerState {
  const style = cfg.loadout.style;
  const offensivePrayer: OffensivePrayer = style === 'ranged' ? 'rigour' : style === 'magic' ? 'augury' : 'piety';
  return {
    pos: { ...spawn },
    moveTarget: null,
    running: true,
    runEnergy: 100,
    hp: cfg.skills.hp,
    maxHp: cfg.skills.hp,
    prayer: cfg.skills.prayer,
    maxPrayer: cfg.skills.prayer,
    boosts: { atk: 0, str: 0, def: 0, hp: 0, magic: 0, ranged: 0, prayer: 0 },
    divineUntil: -1,
    divineBoosts: null,
    protectMelee: false,
    protectMeleeOnTick: -99,
    offensivePrayer,
    offensiveOn: false,
    drain: { accumulator: 0 },
    foodCd: 0,
    potionCd: 0,
    karambwanCd: 0,
    attackDelay: 0,
    weaponCd: 0,
    specEnergy: 100,
    specRegenCounter: 0,
    specArmed: false,
    activeGearSet: 0,
    inventory: cfg.inventory.map((s) => ({ ...s })),
    alive: true,
  };
}

export function activePrayers(p: PlayerState): PrayerId[] {
  const out: PrayerId[] = [];
  if (p.offensiveOn) out.push(p.offensivePrayer);
  if (p.protectMelee) out.push('protectMelee');
  return out;
}

/** Per-tick upkeep: cooldowns, prayer drain, boost decay, energy regen. */
export function tickPlayerUpkeep(
  p: PlayerState,
  tick: number,
  prayerBonus: number,
  drainMult: number,
): void {
  if (p.foodCd > 0) p.foodCd--;
  if (p.potionCd > 0) p.potionCd--;
  if (p.karambwanCd > 0) p.karambwanCd--;
  if (p.attackDelay > 0) p.attackDelay--;
  if (p.weaponCd > 0) p.weaponCd--;

  const lost = tickPrayerDrain(p.drain, activePrayers(p), prayerBonus, drainMult);
  if (lost > 0) {
    p.prayer = Math.max(0, p.prayer - lost);
    if (p.prayer === 0) {
      p.protectMelee = false;
      p.offensiveOn = false;
    }
  }

  // Boost decay: 1 level toward 0 per 100 ticks. Divine potions re-pin
  // their boost until they expire.
  if (tick > 0 && tick % BOOST_DECAY_INTERVAL === 0) {
    for (const k of Object.keys(p.boosts) as (keyof PlayerSkills)[]) {
      if (p.boosts[k] > 0) p.boosts[k]--;
      else if (p.boosts[k] < 0) p.boosts[k]++;
    }
  }
  if (p.divineBoosts && tick <= p.divineUntil) {
    for (const [k, v] of Object.entries(p.divineBoosts) as [keyof PlayerSkills, number][]) {
      if (p.boosts[k] < v) p.boosts[k] = v;
    }
  } else if (p.divineBoosts && tick > p.divineUntil) {
    p.divineBoosts = null;
  }

  // Spec energy: 10% per 50 ticks.
  p.specRegenCounter++;
  if (p.specRegenCounter >= SPEC_REGEN_TICKS_PER_10) {
    p.specRegenCounter = 0;
    p.specEnergy = Math.min(100, p.specEnergy + 10);
  }
}

export function effectiveSkills(cfg: PlayerConfig, p: PlayerState): PlayerSkills {
  const s = { ...cfg.skills };
  for (const k of Object.keys(p.boosts) as (keyof PlayerSkills)[]) {
    s[k] = Math.max(0, s[k] + p.boosts[k]);
  }
  return s;
}

/** Consume the inventory slot. Returns the consumed item id or an error. */
export function consume(
  p: PlayerState,
  cfg: PlayerConfig,
  invIndex: number,
  tick: number,
): { ok: true; itemId: string } | { ok: false; reason: string } {
  const slot = p.inventory[invIndex];
  if (!slot || !slot.itemId || slot.qty <= 0) return { ok: false, reason: 'empty slot' };
  const def = CONSUMABLE_INDEX.get(slot.itemId);
  if (!def) return { ok: false, reason: 'unknown item' };

  // Independent cooldown channels — the standard food/potion/karambwan
  // combo-eat rules fall out of these three timers.
  if (def.kind === 'food' && p.foodCd > 0) return { ok: false, reason: 'food cooldown' };
  if (def.kind === 'potion' && p.potionCd > 0) return { ok: false, reason: 'potion cooldown' };
  if (def.kind === 'karambwan' && p.karambwanCd > 0) return { ok: false, reason: 'karambwan cooldown' };

  if (def.heal || def.overheal) {
    const cap = p.maxHp + (def.overheal ?? 0);
    p.hp = Math.min(cap, p.hp + (def.heal ?? 0) + (def.overheal && def.heal === 0 ? def.overheal : 0));
    // Brews: heal is expressed entirely via overheal cap + hp boost table.
  }
  if (def.prayerRestore) {
    const r = def.prayerRestore;
    p.prayer = Math.min(p.maxPrayer, p.prayer + r.flat + Math.floor((cfg.skills.prayer * r.perLevelNum) / r.perLevelDen));
  }
  if (def.boosts) {
    const applied: Partial<Record<keyof PlayerSkills, number>> = {};
    for (const [k, b] of Object.entries(def.boosts) as [keyof PlayerSkills, { pct: number; flat: number }][]) {
      const boost = Math.floor(cfg.skills[k] * b.pct) + b.flat;
      p.boosts[k] = Math.max(p.boosts[k], boost);
      applied[k] = boost;
    }
    if (def.divineTicks) {
      p.divineUntil = tick + def.divineTicks;
      p.divineBoosts = applied;
    }
  }
  if (def.drains) {
    for (const [k, d] of Object.entries(def.drains) as [keyof PlayerSkills, { pct: number; flat: number }][]) {
      p.boosts[k] -= Math.floor(cfg.skills[k] * d.pct) + d.flat;
    }
  }

  if (def.kind === 'food') p.foodCd = EAT_COOLDOWN;
  else if (def.kind === 'potion') p.potionCd = POTION_COOLDOWN;
  else p.karambwanCd = KARAMBWAN_COOLDOWN;
  p.attackDelay = Math.max(p.attackDelay, def.attackDelay);

  slot.qty--;
  if (slot.qty <= 0) slot.itemId = null;
  return { ok: true, itemId: def.id };
}

/**
 * Move up to 1 (walk) or 2 (run) steps toward the target along an 8-dir
 * greedy path, refusing tiles that are out of bounds, under the boss, or
 * molten sand. Greedy stepping is a documented simplification of full
 * pathing — the open arena has no concave obstacles until sand
 * accumulates, at which point a blocked greedy step simply halts (as a
 * real player would re-click).
 */
export function tickMovement(p: PlayerState, bossAnchor: Vec, sand: ReadonlySet<string>): number {
  if (!p.moveTarget) {
    p.runEnergy = Math.min(100, p.runEnergy + RUN_REGEN_PER_TICK);
    return 0;
  }
  const steps = p.running && p.runEnergy >= RUN_DRAIN_PER_TILE ? 2 : 1;
  let moved = 0;
  for (let i = 0; i < steps; i++) {
    const t = p.moveTarget;
    if (!t || (p.pos.x === t.x && p.pos.y === t.y)) break;
    const dx = Math.sign(t.x - p.pos.x);
    const dy = Math.sign(t.y - p.pos.y);
    // Try the diagonal, then each axis — greedy with fallbacks.
    const candidates: Vec[] = [
      { x: p.pos.x + dx, y: p.pos.y + dy },
      { x: p.pos.x + dx, y: p.pos.y },
      { x: p.pos.x, y: p.pos.y + dy },
    ];
    let stepped = false;
    for (const c of candidates) {
      if ((c.x === p.pos.x && c.y === p.pos.y) || !inArena(c.x, c.y)) continue;
      if (underBoss(bossAnchor, c.x, c.y) || sand.has(tileKey(c.x, c.y))) continue;
      p.pos = c;
      moved++;
      stepped = true;
      break;
    }
    if (!stepped) break;
  }
  if (p.moveTarget && p.pos.x === p.moveTarget.x && p.pos.y === p.moveTarget.y) p.moveTarget = null;
  if (moved >= 2) p.runEnergy = Math.max(0, p.runEnergy - RUN_DRAIN_PER_TILE * moved);
  else if (moved === 0) p.runEnergy = Math.min(100, p.runEnergy + RUN_REGEN_PER_TICK);
  return moved;
}
