/**
 * Player model for the Zuk fight. Mirrors the Sol Heredit player (stats,
 * boosts, consumable cooldown channels, run-energy movement, spec/gear
 * index) but the single Protect-from-Melee boolean is generalised to an
 * `overhead` prayer that can be melee / ranged / magic, because Zuk's fight
 * is all about switching overheads for the magers and Jad.
 */
import type { PlayerSkills } from '@shared/types';
import { tickPrayerDrain, type PrayerDrainState, type PrayerId } from '@engine/prayerDrain';
import {
  ARENA_H,
  ARENA_W,
  CONSUMABLE_INDEX,
  ZUK_SIZE,
} from './constants';
import type { InventorySlot, Overhead, PlayerConfig, Vec } from './types';

const EAT_COOLDOWN = 3;
const POTION_COOLDOWN = 3;
const KARAMBWAN_COOLDOWN = 3;
const RUN_DRAIN_PER_TILE = 0.67;
const RUN_REGEN_PER_TICK = 0.45;
const BOOST_DECAY_INTERVAL = 100;

const OVERHEAD_TO_PRAYER: Record<Overhead, PrayerId> = {
  melee: 'protectMelee',
  ranged: 'protectMissiles',
  magic: 'protectMagic',
};

export interface PlayerState {
  pos: Vec;
  moveTarget: Vec | null;
  running: boolean;
  runEnergy: number;
  hp: number;
  maxHp: number;
  prayer: number;
  maxPrayer: number;
  boosts: Record<keyof PlayerSkills, number>;
  divineUntil: number;
  divineBoosts: Partial<Record<keyof PlayerSkills, number>> | null;
  /** Active overhead protection prayer, or null. */
  overhead: Overhead | null;
  /** Tick the overhead was last switched — exact-tick block checks read it. */
  overheadOnTick: number;
  offensiveOn: boolean;
  drain: PrayerDrainState;
  foodCd: number;
  potionCd: number;
  karambwanCd: number;
  attackDelay: number;
  weaponCd: number;
  targetId: number;
  activeGearSet: number;
  inventory: InventorySlot[];
  alive: boolean;
}

export function initPlayer(cfg: PlayerConfig, spawn: Vec): PlayerState {
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
    overhead: null,
    overheadOnTick: -99,
    offensiveOn: false,
    drain: { accumulator: 0 },
    foodCd: 0,
    potionCd: 0,
    karambwanCd: 0,
    attackDelay: 0,
    weaponCd: 0,
    targetId: 0,
    activeGearSet: 0,
    inventory: cfg.inventory.map((s) => ({ ...s })),
    alive: true,
  };
}

export function activePrayers(p: PlayerState): PrayerId[] {
  const out: PrayerId[] = [];
  if (p.offensiveOn) out.push('rigour'); // ranged fight → Rigour
  if (p.overhead) out.push(OVERHEAD_TO_PRAYER[p.overhead]);
  return out;
}

export function tickPlayerUpkeep(p: PlayerState, tick: number, prayerBonus: number): void {
  if (p.foodCd > 0) p.foodCd--;
  if (p.potionCd > 0) p.potionCd--;
  if (p.karambwanCd > 0) p.karambwanCd--;
  if (p.attackDelay > 0) p.attackDelay--;
  if (p.weaponCd > 0) p.weaponCd--;

  const lost = tickPrayerDrain(p.drain, activePrayers(p), prayerBonus);
  if (lost > 0) {
    p.prayer = Math.max(0, p.prayer - lost);
    if (p.prayer === 0) { p.overhead = null; p.offensiveOn = false; }
  }

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
}

export function consume(
  p: PlayerState,
  skills: PlayerSkills,
  invIndex: number,
  tick: number,
): { ok: true; itemId: string } | { ok: false; reason: string } {
  const slot = p.inventory[invIndex];
  if (!slot || !slot.itemId || slot.qty <= 0) return { ok: false, reason: 'empty slot' };
  const def = CONSUMABLE_INDEX.get(slot.itemId);
  if (!def) return { ok: false, reason: 'unknown item' };

  if (def.kind === 'food' && p.foodCd > 0) return { ok: false, reason: 'food cooldown' };
  if (def.kind === 'potion' && p.potionCd > 0) return { ok: false, reason: 'potion cooldown' };
  if (def.kind === 'karambwan' && p.karambwanCd > 0) return { ok: false, reason: 'karambwan cooldown' };

  if (def.heal || def.overheal) {
    const cap = p.maxHp + (def.overheal ?? 0);
    p.hp = Math.min(cap, p.hp + (def.heal ?? 0));
  }
  if (def.healOverheal) {
    // Brew: flat heal that can overheal past max.
    p.hp = Math.min(p.maxHp + def.healOverheal, p.hp + def.healOverheal);
    p.boosts.def = Math.max(p.boosts.def, Math.floor(skills.def * 0.2) + 2);
  }
  if (def.prayerRestore) {
    const r = def.prayerRestore;
    p.prayer = Math.min(p.maxPrayer, p.prayer + r.flat + Math.floor((skills.prayer * r.perLevelNum) / r.perLevelDen));
  }
  if (def.rangedBoost) {
    const boost = Math.floor(skills.ranged * def.rangedBoost.pct) + def.rangedBoost.flat;
    p.boosts.ranged = Math.max(p.boosts.ranged, boost);
    if (def.divineTicks) {
      p.divineUntil = tick + def.divineTicks;
      p.divineBoosts = { ranged: boost };
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

function inArena(x: number, y: number): boolean {
  return x >= 0 && x < ARENA_W && y >= 0 && y < ARENA_H;
}

/** Zuk's 7x7 footprint against the north wall is impassable. */
function underZuk(x: number, y: number): boolean {
  const zx0 = Math.floor((ARENA_W - ZUK_SIZE) / 2);
  return x >= zx0 && x < zx0 + ZUK_SIZE && y >= ARENA_H - ZUK_SIZE;
}

/** Greedy 8-directional movement (1 walk / 2 run steps per tick). */
export function tickMovement(p: PlayerState): number {
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
    const candidates: Vec[] = [
      { x: p.pos.x + dx, y: p.pos.y + dy },
      { x: p.pos.x + dx, y: p.pos.y },
      { x: p.pos.x, y: p.pos.y + dy },
    ];
    let stepped = false;
    for (const c of candidates) {
      if ((c.x === p.pos.x && c.y === p.pos.y) || !inArena(c.x, c.y) || underZuk(c.x, c.y)) continue;
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
