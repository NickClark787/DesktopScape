/**
 * Types for the Sol Heredit simulator. Pure data — no DOM, no React.
 * The engine consumes the app's existing gear/loadout model
 * (@shared/types) and the shared combat calc (@engine/formulas).
 */
import type { EquipmentPiece, Monster, PlayerLoadout, PlayerSkills } from '@shared/types';

// ---------------------------------------------------------------- geometry

export interface Vec {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- attacks

export type AoeAttack = 'spear1' | 'spear2' | 'shield1' | 'shield2';
export type BossAttack = AoeAttack | 'tripleParry' | 'grapple';
export type AttackClass = 'spear' | 'shield';

/** Equipment slots Sol can call during the Grapple attack. */
export type GrappleSlot = 'head' | 'body' | 'legs' | 'weapon' | 'shield';

// ---------------------------------------------------------------- config

export interface LatencyConfig {
  /** One-way input delay in ms. 0 = tick-perfect reference mode. */
  pingMs: number;
  /** Uniform jitter ±ms added per input. */
  jitterMs: number;
  /** 0..100 — chance an input is dropped entirely. */
  packetLossPct: number;
}

/** Colosseum modifier effects the Sol fight cares about. Declarative so the
 *  modifier list is data, not code. */
export interface ModifierEffects {
  /** Multiplier on typeless AoE / beam / sand damage taken. */
  aoeDamageMult?: number;
  /** Multiplier on prayer drain rate (Blasphemy). */
  prayerDrainMult?: number;
  /** Multiplier on the player's defence roll (Frailty). */
  playerDefenceMult?: number;
  /** Flat addition to Sol's melee max hits (Relentless-style). */
  bossMaxHitAdd?: number;
}

export interface ColosseumModifier {
  id: string;
  name: string;
  description: string;
  effects: ModifierEffects;
}

export type PracticeMode = 'full' | 'tripleParry' | 'grapple' | 'dodgeOnly' | 'singlePhase';

export interface BossOptions {
  /** 1..100 — starting HP percentage. */
  startHpPct: number;
  /** Phase-transition thresholds (fraction of max HP) that actually fire. */
  enabledTransitions: number[];
  /** Active colosseum modifier ids (resolved against the modifier list). */
  modifierIds: string[];
  /** Forced attack rotation for drilling; empty = normal AI. Loops. */
  forcedRotation: BossAttack[];
  /** Boss HP never drops (dodge practice). */
  infiniteHp: boolean;
  practiceMode: PracticeMode;
  /** For practiceMode 'singlePhase': 0-based phase index (0 = 100-90%). */
  practicePhase: number;
}

export interface AssistOptions {
  hazardOverlay: boolean;
  nextAttackPrediction: boolean;
  prayerTimingIndicator: boolean;
  safeTileHighlight: boolean;
}

/** One equippable gear set. `switchSlots` lists what changes vs main. */
export interface GearSet {
  name: string;
  equipment: PlayerLoadout['equipment'];
}

export type ConsumableKind = 'food' | 'karambwan' | 'potion';

export interface ConsumableDef {
  id: string;
  name: string;
  kind: ConsumableKind;
  /** HP healed (food) — anglerfish-style overheal expressed via `overheal`. */
  heal?: number;
  overheal?: number;
  /** Attack-delay ticks added when consumed. */
  attackDelay: number;
  /** Prayer points restored: fixed + fraction of level. */
  prayerRestore?: { flat: number; perLevelNum: number; perLevelDen: number };
  /** Stat boosts applied on sip: fraction + flat per skill. */
  boosts?: Partial<Record<keyof PlayerSkills, { pct: number; flat: number }>>;
  /** Stat drains applied on sip (sara brew combat drain). */
  drains?: Partial<Record<keyof PlayerSkills, { pct: number; flat: number }>>;
  /** Divine: re-pins the boost for this many ticks. */
  divineTicks?: number;
  doses?: number;
}

export interface InventorySlot {
  /** Consumable id, or null for an empty slot. Gear switches live in GearSets. */
  itemId: string | null;
  qty: number;
}

export interface PlayerConfig {
  skills: PlayerSkills;
  /** Main combat gear (loadout carries style/stance/attackStyle). */
  loadout: PlayerLoadout;
  /** Additional gear sets (spec weapon, defensive switch). */
  gearSets: GearSet[];
  inventory: InventorySlot[];
  /** Spec weapon config: applied when the active set's weapon matches. */
  specs: SpecDef[];
}

export interface SpecDef {
  weaponName: string;
  energyCost: number;
  damageMult: number;
  accuracyMult: number;
}

export interface SimConfig {
  seed: number;
  monster: Monster;
  latency: LatencyConfig;
  boss: BossOptions;
  assists: AssistOptions;
  player: PlayerConfig;
}

// ---------------------------------------------------------------- inputs

export type InputCommand =
  | { kind: 'move'; to: Vec; run: boolean }
  | { kind: 'pray'; prayer: 'protectMelee' | 'offensive'; on: boolean }
  | { kind: 'eat'; invIndex: number }
  | { kind: 'switchGear'; setIndex: number }
  | { kind: 'spec' }
  | { kind: 'parry'; slot: GrappleSlot }
  | { kind: 'attackBoss' };

/** An input as issued client-side. Latency maps it to an effect tick. */
export interface TimedInput {
  cmd: InputCommand;
  clientTick: number;
  /** ms into the client tick when the key/click happened (0..599). */
  msIntoTick: number;
}

// ---------------------------------------------------------------- events

export type SimEvent =
  | { tick: number; type: 'bossAttackDeclared'; attack: BossAttack; resolveTick: number; grappleSlot?: GrappleSlot }
  | { tick: number; type: 'playerDamaged'; source: string; amount: number; avoidable: boolean; correctAction?: string }
  | { tick: number; type: 'playerDodged'; attack: AoeAttack }
  | { tick: number; type: 'playerHitBoss'; damage: number; spec: boolean }
  | { tick: number; type: 'parryBlocked'; hitIndex: number }
  | { tick: number; type: 'parryFailed'; hitIndex: number; reason: string }
  | { tick: number; type: 'grappleParried'; perfect: boolean }
  | { tick: number; type: 'grappleFailed'; reason: string }
  | { tick: number; type: 'phaseTransition'; hpFrac: number }
  | { tick: number; type: 'beamHit'; damage: number; prayerDrained: number }
  | { tick: number; type: 'consumed'; itemId: string }
  | { tick: number; type: 'prayer'; prayer: string; on: boolean }
  | { tick: number; type: 'inputDropped'; cmd: InputCommand }
  | { tick: number; type: 'death' }
  | { tick: number; type: 'bossKilled' };

// ---------------------------------------------------------------- replay

export interface ReplayFile {
  version: 1;
  seed: number;
  /** Serialized SimConfig minus the Monster (re-resolved by id on import). */
  monsterId: number;
  config: Omit<SimConfig, 'monster' | 'seed'>;
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
  bossHpLeft: number;
  playerDps: number;
  theoreticalDps: number;
  damageBySource: Record<string, number>;
  dodges: Record<AoeAttack, { dodged: number; total: number }>;
  tripleParry: { blocked: number; total: number };
  grapple: { parried: number; perfect: number; total: number };
  suppliesUsed: Record<string, number>;
  mistakes: MistakeEntry[];
  assistsUsed: boolean;
}

// ---------------------------------------------------------------- snapshot

/** A transition light beam as the renderer sees it. `done` beams have
 *  already fired and are kept only so the array identity stays stable. */
export interface BeamView {
  pos: Vec;
  /** Tick molten sand spawns on the beam tile. */
  sandTick: number;
  /** Tick the beam launches its sphere. */
  fireTick: number;
  done: boolean;
}

/**
 * Read-only view for the render layer. Reused between ticks — the render
 * loop must not mutate or retain it.
 *
 * Everything the visual layer needs about the fight lives here: the
 * renderer never recomputes hazard shapes, facings or timings, it only
 * draws what this struct reports. Fields are grouped by what they drive.
 */
export interface SimSnapshot {
  tick: number;

  // -- player ------------------------------------------------------------
  playerPos: Vec;
  playerHp: number;
  playerMaxHp: number;
  playerPrayer: number;
  playerMaxPrayer: number;
  runEnergy: number;
  specEnergy: number;
  activePrayers: string[];
  /** Where the player is walking, or null when standing still. */
  playerMoveTarget: Vec | null;
  playerRunning: boolean;
  playerAlive: boolean;
  /** Ticks left on the weapon cooldown — drives the swing cadence visual. */
  playerWeaponCd: number;
  /** Ticks the next attack is delayed by (eating, switching). */
  playerAttackDelay: number;
  playerProtectMelee: boolean;
  /** Tick Protect from Melee last went OFF→ON (parry-timing feedback). */
  playerProtectMeleeOnTick: number;
  playerOffensiveOn: boolean;
  playerOffensivePrayer: string;
  playerSpecArmed: boolean;

  // -- boss --------------------------------------------------------------
  bossAnchor: Vec;
  bossHp: number;
  bossMaxHp: number;
  bossAttack: BossAttack | null;
  /** Tick the current attack was declared (-1 when idle) — windup start. */
  bossAttackDeclareTick: number;
  bossAttackResolveTick: number;
  /** Cardinal facing the engine used to orient the current hazard. */
  bossFacing: Vec;
  /** Triple Parry: the three hit ticks, in order. Empty otherwise. */
  tripleHitTicks: ReadonlyArray<number>;
  grappleSlot: GrappleSlot | null;
  /** First and last tick a grapple parry is accepted (-1 when idle). */
  grappleWindowStart: number;
  grappleWindowEnd: number;
  grappleParried: boolean;
  grapplePerfect: boolean;
  /** Boss HP is below the enrage gate. */
  enraged: boolean;
  /** Tick the boss resumes after a phase transition (-1 when not pausing). */
  transitionEndTick: number;
  /** Tick the next attack is declared — assist-gated in the UI. */
  nextAttackTick: number;
  /** End tick of the perfect-parry guaranteed-max window (-1 = none). */
  guaranteedMaxUntilTick: number;

  // -- terrain -----------------------------------------------------------
  hazardTiles: ReadonlySet<string>;
  sandTiles: ReadonlySet<string>;
  beams: ReadonlyArray<BeamView>;

  // -- network -----------------------------------------------------------
  /** Inputs in flight: sent by the client, not yet processed by the sim. */
  pendingInputCount: number;
  /** Destination of an in-flight move — the click marker the client shows
   *  before the server has registered it. */
  pendingMoveTarget: Vec | null;
  /** effectTick − clientTick for the most recent accepted input (-1 none). */
  lastInputLagTicks: number;

  nextAttackHint: BossAttack | null;
  activeGearSet: number;
  finished: boolean;
}
