/**
 * Types for the TzKal-Zuk (Inferno wave 69) simulator. Pure data — no DOM,
 * no React. Mirrors the Sol Heredit sim's shape: SimConfig / TimedInput /
 * SimEvent / SimSnapshot / ResultsSummary, adapted to a ranged prayer-
 * switching add-management fight instead of a melee dodge fight.
 */
import type { EquipmentPiece, Monster, PlayerLoadout, PlayerSkills } from '@shared/types';

// ---------------------------------------------------------------- geometry

export interface Vec {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- entities

/** Every damageable actor in the arena. Zuk is always entity 0. */
export type EntityKind = 'zuk' | 'ranger' | 'mager' | 'jad' | 'healer';

/** The overhead protection prayers the player can flick. */
export type Overhead = 'melee' | 'ranged' | 'magic';

/** Attack styles the adds use — drives which overhead blocks them. */
export type AddStyle = 'ranged' | 'magic';

// ---------------------------------------------------------------- config

export interface LatencyConfig {
  pingMs: number;
  jitterMs: number;
  packetLossPct: number;
}

/** Inferno practice-modifier effects. Declarative so the list is data. */
export interface ModifierEffects {
  disableGlyph?: boolean;
  glyphHp?: number;
  setIntervalMult?: number;
  /** Multiplier on all damage the player takes. */
  incomingDamageMult?: number;
}

export interface InfernoModifier {
  id: string;
  name: string;
  description: string;
  effects: ModifierEffects;
}

export type PracticeMode =
  | 'full'
  | 'zukOnly'      // just Zuk + glyph, no adds/Jad/healers
  | 'sets'         // Zuk + repeating add sets, no Jad/healers
  | 'jad'          // start at the Jad spawn
  | 'healers';     // start at enrage with healers up

export interface BossOptions {
  /** 1..100 — starting Zuk HP percentage. */
  startHpPct: number;
  /** Active modifier ids (resolved against INFERNO_MODIFIERS). */
  modifierIds: string[];
  /** Force the glyph to hold still for positioning practice. */
  freezeGlyph: boolean;
  practiceMode: PracticeMode;
}

export interface AssistOptions {
  /** Highlight the tiles the glyph currently protects. */
  glyphSafeHighlight: boolean;
  /** Show each add's next-attack tick and style. */
  addTimers: boolean;
  /** Show Jad's telegraphed style before it lands. */
  jadPrayerIndicator: boolean;
  /** Show the next add-set countdown. */
  setCountdown: boolean;
}

export interface GearSet {
  name: string;
  equipment: PlayerLoadout['equipment'];
}

export type ConsumableKind = 'food' | 'karambwan' | 'potion';

export interface ConsumableDef {
  id: string;
  name: string;
  kind: ConsumableKind;
  heal?: number;
  overheal?: number;
  /** Brew-style flat heal + overheal cap. */
  healOverheal?: number;
  attackDelay: number;
  prayerRestore?: { flat: number; perLevelNum: number; perLevelDen: number };
  rangedBoost?: { pct: number; flat: number };
  divineTicks?: number;
  doses?: number;
}

export interface InventorySlot {
  itemId: string | null;
  qty: number;
}

export interface PlayerConfig {
  skills: PlayerSkills;
  loadout: PlayerLoadout;
  gearSets: GearSet[];
  inventory: InventorySlot[];
}

export interface SimConfig {
  seed: number;
  /** Zuk monster row (id 7706) for the player's damage calc. */
  monster: Monster;
  /** Add monster rows keyed by kind for per-target calc. */
  addMonsters: Partial<Record<EntityKind, Monster>>;
  latency: LatencyConfig;
  boss: BossOptions;
  assists: AssistOptions;
  player: PlayerConfig;
}

// ---------------------------------------------------------------- inputs

export type InputCommand =
  | { kind: 'move'; to: Vec; run: boolean }
  | { kind: 'pray'; overhead: Overhead | null }
  | { kind: 'prayOffensive'; on: boolean }
  | { kind: 'target'; entityId: number }
  | { kind: 'eat'; invIndex: number }
  | { kind: 'switchGear'; setIndex: number };

export interface TimedInput {
  cmd: InputCommand;
  clientTick: number;
  msIntoTick: number;
}

// ---------------------------------------------------------------- events

export type SimEvent =
  | { tick: number; type: 'zukAttackDeclared'; landTick: number }
  | { tick: number; type: 'zukAttack'; blocked: boolean; damage: number }
  | { tick: number; type: 'glyphDestroyed' }
  | { tick: number; type: 'addSpawned'; entityId: number; kind: EntityKind }
  | { tick: number; type: 'addAttackDeclared'; entityId: number; kind: EntityKind; style: AddStyle; landTick: number }
  | { tick: number; type: 'addAttack'; entityId: number; kind: EntityKind; style: AddStyle; blocked: boolean; damage: number }
  | { tick: number; type: 'addKilled'; entityId: number; kind: EntityKind }
  | { tick: number; type: 'magerRevived'; entityId: number }
  | { tick: number; type: 'playerHit'; targetId: number; kind: EntityKind; damage: number }
  | { tick: number; type: 'zukHealed'; amount: number }
  | { tick: number; type: 'enrage' }
  | { tick: number; type: 'playerDamaged'; source: string; amount: number; correctAction?: string }
  | { tick: number; type: 'prayer'; overhead: Overhead | null }
  | { tick: number; type: 'consumed'; itemId: string }
  | { tick: number; type: 'inputDropped'; cmd: InputCommand }
  | { tick: number; type: 'death' }
  | { tick: number; type: 'zukKilled' };

// ---------------------------------------------------------------- replay

export interface ReplayFile {
  version: 1;
  seed: number;
  monsterId: number;
  config: Omit<SimConfig, 'monster' | 'seed' | 'addMonsters'>;
  inputs: TimedInput[];
}

// ---------------------------------------------------------------- results

export interface MistakeEntry {
  tick: number;
  what: string;
  correctAction: string;
  damage: number;
}

export interface ResultsSummary {
  outcome: 'kill' | 'death' | 'timeout' | 'aborted';
  ticks: number;
  seconds: number;
  zukHpLeft: number;
  glyphHpLeft: number;
  glyphDestroyed: boolean;
  playerDps: number;
  theoreticalDps: number;
  damageBySource: Record<string, number>;
  addsKilled: Record<EntityKind, number>;
  /** Prayer-switch accuracy vs Jad and the magers. */
  prayerSwitches: { correct: number; total: number };
  zukHealed: number;
  suppliesUsed: Record<string, number>;
  mistakes: MistakeEntry[];
  assistsUsed: boolean;
}

// ---------------------------------------------------------------- snapshot

export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  pos: Vec;
  size: number;
  hp: number;
  maxHp: number;
  /** Pending attack style + land tick, or null when not winding up. */
  windup: { style: AddStyle; landTick: number } | null;
}

/** Read-only render view. Reused between ticks — do not retain/mutate. */
export interface SimSnapshot {
  tick: number;
  playerPos: Vec;
  playerHp: number;
  playerMaxHp: number;
  playerPrayer: number;
  playerMaxPrayer: number;
  runEnergy: number;
  overhead: Overhead | null;
  offensiveOn: boolean;
  targetId: number;
  zukHp: number;
  zukMaxHp: number;
  zukWindupLandTick: number;
  enraged: boolean;
  glyphHp: number;
  glyphMaxHp: number;
  glyphDestroyed: boolean;
  /** Columns [x0, x1) the glyph currently covers. */
  glyphSpan: { x0: number; x1: number; row: number } | null;
  playerBehindGlyph: boolean;
  entities: EntitySnapshot[];
  setCountdown: number;
  finished: boolean;
}
