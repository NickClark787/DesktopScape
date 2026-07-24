/**
 * Numbers for the Sol Heredit fight, verified against the OSRS Wiki
 * (`Sol_Heredit`, `Fortis_Colosseum/Strategies`) on 2026-07-12.
 *
 * Deviations from the spec that follow the wiki (per instructions):
 *  - Typeless AoE / grapple max hit is 44 (spec said "~45").
 *  - Phase-transition light beams launch their sphere 4 ticks after the
 *    beam appears and hit up to 75 (spec described only the sand).
 *  - Failed Triple Parry hits deal up to 15/25/35 (variant 1, ≥50% HP) or
 *    15/30/45 (variant 2, <50% HP) — the spec didn't give damage tiers.
 * The wiki does not publish the attack cadence in ticks; the spec's
 * 7t spear / 6t shield, both −1 after the 75% transition, is used.
 */
import type { ColosseumModifier, ConsumableDef } from './types';

export const TICK_MS = 600;

// Arena: ~16x15 tiles between the pillars (spec). x: 0..15, y: 0..14,
// y grows northward. The boss anchor is its south-west tile.
export const ARENA_W = 16;
export const ARENA_H = 15;
export const BOSS_SIZE = 5;

export const BOSS_MAX_HP = 1500;

/** Phase-transition thresholds as fractions of max HP. */
export const PHASE_THRESHOLDS = [0.9, 0.75, 0.5, 0.25, 0.1] as const;

// Attack cadence (ticks between attack declarations).
export const SPEAR_SPEED = 7;
export const SHIELD_SPEED = 6;
/** Both speeds drop by 1 after the 75% transition completes. */
export const SPEEDUP_AFTER_TRANSITION = 0.75;

/** Hazards are declared with the attack and resolve 1 tick later — the
 *  dodge window. Damage is typeless; Protect from Melee does NOT reduce it. */
export const AOE_RESOLVE_DELAY = 1;
export const AOE_MAX_HIT = 44; // wiki: 44 typeless

// Triple Parry (below 90% HP). Hits land at +3, +6, +9 ticks from the
// declaration; below 50% HP the third hit is 1 tick later (+3, +6, +10).
export const TRIPLE_FIRST_OFFSET = 3;
export const TRIPLE_GAP = 3;
export const TRIPLE_THIRD_GAP_SLOW = 4;
export const TRIPLE_VARIANT1_MAX = [15, 25, 35] as const; // ≥50% HP
export const TRIPLE_VARIANT2_MAX = [15, 30, 45] as const; // <50% HP
export const TRIPLE_HP_GATE = 0.9;
export const TRIPLE_SLOW_GATE = 0.5;

// Grapple (below 75% HP): 4 ticks to click the called slot. Parry landing
// exactly on the last tick = perfect parry → Sol's next attack within 5
// ticks is a guaranteed max hit.
export const GRAPPLE_HP_GATE = 0.75;
export const GRAPPLE_WINDOW = 4;
export const GRAPPLE_MAX_HIT = 44;
export const GRAPPLE_PERFECT_BUFF_TICKS = 5;

// Phase transitions: 6 light beams appear in a 9x9 around the player;
// molten sand spawns on the beam tiles 2 ticks later; each beam launches a
// sphere 4 ticks after appearing (up to 75 damage, prayer-smiting). The
// boss resumes attacking 6 ticks after the transition starts, always with
// a spear (Spear 2 if his previous attack was Spear 1).
export const TRANSITION_BEAM_COUNT = 6;
export const TRANSITION_BEAM_AREA = 9;
export const BEAM_SAND_DELAY = 2;
export const BEAM_FIRE_DELAY = 4;
export const BEAM_MAX_HIT = 75; // wiki: "up to 75 damage"
/** Smite-style prayer drain on beam hits: floor(damage / 4). */
export const BEAM_SMITE_DIVISOR = 4;
export const TRANSITION_PAUSE = 6;

// Enrage (below 10% HP): molten sand spawns every 3 ticks on random tiles.
export const ENRAGE_HP_GATE = 0.1;
export const ENRAGE_SAND_INTERVAL = 3;

// Boss AI selection weights (when eligible and not forced). The wiki gives
// no published rates; these produce rotations resembling recorded fights
// and are trivially overridable via forcedRotation for drills.
export const TRIPLE_PARRY_CHANCE = 0.2;
export const GRAPPLE_CHANCE = 0.15;
/** Minimum normal attacks between special attacks. */
export const SPECIAL_COOLDOWN_ATTACKS = 3;

// Player timing.
export const EAT_COOLDOWN = 3;
export const POTION_COOLDOWN = 3;
export const KARAMBWAN_COOLDOWN = 3;
/** Spec energy regen: 10% per 30s → 100/500 ticks. */
export const SPEC_REGEN_TICKS_PER_10 = 50;
/** Run energy: simplified flat drain per run-tile and regen per idle tick. */
export const RUN_DRAIN_PER_TILE = 0.67;
export const RUN_REGEN_PER_TICK = 0.45;
/** Boost decay: 1 level per 100 ticks (1/min), matching the game. */
export const BOOST_DECAY_INTERVAL = 100;

export const MELEE_RANGE = 1; // Chebyshev distance from the boss bounding box

// ---------------------------------------------------------------- modifiers

/** Colosseum modifiers relevant to the Sol fight. Declarative — add more
 *  entries, no engine changes needed. */
export const COLOSSEUM_MODIFIERS: ColosseumModifier[] = [
  {
    id: 'solarflare',
    name: 'Solarflare',
    description: 'Sol’s typeless attacks and molten hazards deal 25% more damage.',
    effects: { aoeDamageMult: 1.25 },
  },
  {
    id: 'blasphemy',
    name: 'Blasphemy',
    description: 'Prayer drains 25% faster.',
    effects: { prayerDrainMult: 1.25 },
  },
  {
    id: 'frailty',
    name: 'Frailty',
    description: 'Your defence roll is reduced by 15%.',
    effects: { playerDefenceMult: 0.85 },
  },
  {
    id: 'relentless',
    name: 'Relentless',
    description: 'Sol’s melee hits gain +5 max hit.',
    effects: { bossMaxHitAdd: 5 },
  },
];

// ---------------------------------------------------------------- consumables

export const CONSUMABLES: ConsumableDef[] = [
  { id: 'shark', name: 'Shark', kind: 'food', heal: 20, attackDelay: 3 },
  { id: 'manta', name: 'Manta ray', kind: 'food', heal: 22, attackDelay: 3 },
  { id: 'anglerfish', name: 'Anglerfish', kind: 'food', heal: 22, overheal: 13, attackDelay: 3 },
  { id: 'karambwan', name: 'Cooked karambwan', kind: 'karambwan', heal: 18, attackDelay: 2 },
  {
    id: 'super_combat', name: 'Super combat potion', kind: 'potion', attackDelay: 3, doses: 4,
    boosts: {
      atk: { pct: 0.15, flat: 5 },
      str: { pct: 0.15, flat: 5 },
      def: { pct: 0.15, flat: 5 },
    },
  },
  {
    id: 'divine_super_combat', name: 'Divine super combat', kind: 'potion', attackDelay: 3, doses: 4,
    divineTicks: 500,
    boosts: {
      atk: { pct: 0.15, flat: 5 },
      str: { pct: 0.15, flat: 5 },
      def: { pct: 0.15, flat: 5 },
    },
  },
  {
    id: 'super_restore', name: 'Super restore', kind: 'potion', attackDelay: 3, doses: 4,
    prayerRestore: { flat: 8, perLevelNum: 1, perLevelDen: 4 },
  },
  {
    id: 'sara_brew', name: 'Saradomin brew', kind: 'potion', attackDelay: 3, doses: 4,
    heal: 0, overheal: 16, // ~15% + 2 at 99 HP, modelled flat via boosts below
    boosts: { def: { pct: 0.2, flat: 2 }, hp: { pct: 0.15, flat: 2 } },
    drains: {
      atk: { pct: 0.1, flat: 2 },
      str: { pct: 0.1, flat: 2 },
      magic: { pct: 0.1, flat: 2 },
      ranged: { pct: 0.1, flat: 2 },
    },
  },
];

export const CONSUMABLE_INDEX = new Map(CONSUMABLES.map((c) => [c.id, c] as const));
