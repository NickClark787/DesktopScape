/**
 * Numbers for the Inferno wave-69 TzKal-Zuk fight, verified against the
 * OSRS Wiki (`TzKal-Zuk`, `Inferno/Strategies`) on 2026-07-12. Values the
 * wiki does not publish (shield tile width / patrol cadence, set-spawn
 * geometry) are modelled from community strategy and flagged below; they
 * are trivially overridable via BossOptions for drills.
 */
import type { ConsumableDef, InfernoModifier } from './types';

export const TICK_MS = 600;

// Arena — the Zuk platform. A rectangular box; x grows east, y grows north.
// Zuk occupies a 7x7 block against the north wall (wiki: size 7). The player
// fights from the southern half, shuffling east/west with the glyph.
export const ARENA_W = 25;
export const ARENA_H = 18;
export const ZUK_SIZE = 7;

export const ZUK_MAX_HP = 1200;

// Zuk's attack: 10 ticks normally, 7 ticks when enraged (wiki). Typeless
// hybrid up to 148 — CANNOT be reduced by prayer or tick-eaten. The ONLY
// defence is standing behind the Ancestral Glyph.
export const ZUK_SPEED = 10;
export const ZUK_SPEED_ENRAGED = 7;
export const ZUK_MAX_HIT = 148;
/** Zuk's shot is declared, then lands this many ticks later. */
export const ZUK_ATTACK_DELAY = 3;

// Ancestral Glyph shield. Wiki: 600 damage destroys it; it patrols and the
// player must move with it. Tile width and cadence aren't published — the
// modelled 5-wide shield moving 1 tile / 2 ticks and reversing at the walls
// reproduces the "shuffle to keep up" gameplay and the ~full-rotation timing
// that gates the first add set.
export const GLYPH_MAX_HP = 600;
export const GLYPH_WIDTH = 5;
export const GLYPH_ROW = ZUK_SIZE + 1; // one row south of Zuk's footprint
/** Ticks between glyph steps. */
export const GLYPH_STEP_TICKS = 2;
/** A glyph hit that isn't blocked-by-position still chips the shield when the
 *  player is behind it (Zuk's shot is absorbed): shield loses this per hit. */
export const GLYPH_ABSORB_PER_HIT = 20;

// Add sets: one Jal-Xil (ranger) + one Jal-Zek (mager) per set. The first
// set spawns after the glyph completes a full patrol rotation; each later
// set ~3:30 (210s = 350 ticks) after the previous. The spawn timer PAUSES
// at 600 Zuk HP and resumes at 480 HP (wiki: adds ~1:45). Modelled as a hard
// pause of the countdown across that HP band.
export const SET_INTERVAL_TICKS = 350;
export const SET_PAUSE_HP = 600;
export const SET_RESUME_HP = 480;

export const RANGER_HP = 125;
export const RANGER_SPEED = 4;
export const RANGER_MAX_HIT = 46;
export const MAGER_HP = 220;
export const MAGER_SPEED = 4;
export const MAGER_MAX_HIT = 70;
/** Jal-Zek resurrects once shortly after death (wiki), unless killed during
 *  the same set cleanup. Modelled as a single revive after this many ticks. */
export const MAGER_REVIVE_DELAY = 6;

// JalTok-Jad spawns when Zuk hits 480 HP. Classic prayer-switch Jad: it
// alternates magic / ranged attacks telegraphed a few ticks ahead; the
// matching overhead prayer must be active on the landing tick or it hits
// for up to 113. Speed 8.
export const JAD_SPAWN_HP = 480;
export const JAD_HP = 350;
export const JAD_SPEED = 8;
export const JAD_MAX_HIT = 113;
/** Jad's attack animation telegraph → landing delay in ticks. */
export const JAD_ATTACK_DELAY = 3;

// 240 HP: Zuk enrages and four Jal-MejJak healers spawn. Each heals Zuk
// 15-25 HP every 3 ticks and can chip the player 5-10 with an AoE.
export const ENRAGE_HP = 240;
export const HEALER_COUNT = 4;
export const HEALER_HP = 75;
export const HEALER_SPEED = 3;
export const HEALER_HEAL_MIN = 15;
export const HEALER_HEAL_MAX = 25;
export const HEALER_HEAL_INTERVAL = 3;
export const HEALER_AOE_MIN = 5;
export const HEALER_AOE_MAX = 10;

export const PROJECTILE_RANGE = 999; // ranged fight — whole arena is in range

// ---------------------------------------------------------------- modifiers

/** Practice modifiers for the Zuk fight — declarative, add more freely. */
export const INFERNO_MODIFIERS: InfernoModifier[] = [
  {
    id: 'no_glyph',
    name: 'No shield',
    description: 'The Ancestral Glyph never appears — pure "don’t get hit by Zuk" practice.',
    effects: { disableGlyph: true },
  },
  {
    id: 'fragile_glyph',
    name: 'Fragile shield',
    description: 'The glyph only has 300 HP.',
    effects: { glyphHp: 300 },
  },
  {
    id: 'hasten_sets',
    name: 'Hastened sets',
    description: 'Add sets spawn twice as fast (drills the double-set panic).',
    effects: { setIntervalMult: 0.5 },
  },
];

// ---------------------------------------------------------------- consumables

/** Ranged-focused Inferno supply table. */
export const CONSUMABLES: ConsumableDef[] = [
  { id: 'anglerfish', name: 'Anglerfish', kind: 'food', heal: 22, overheal: 13, attackDelay: 3 },
  { id: 'saradomin_brew', name: 'Saradomin brew', kind: 'potion', attackDelay: 3, doses: 4, healOverheal: 16 },
  { id: 'super_restore', name: 'Super restore', kind: 'potion', attackDelay: 3, doses: 4, prayerRestore: { flat: 8, perLevelNum: 1, perLevelDen: 4 } },
  { id: 'ranging_potion', name: 'Ranging potion', kind: 'potion', attackDelay: 3, doses: 4, rangedBoost: { pct: 0.1, flat: 4 } },
  { id: 'divine_ranging', name: 'Divine ranging', kind: 'potion', attackDelay: 3, doses: 4, rangedBoost: { pct: 0.1, flat: 4 }, divineTicks: 500 },
  { id: 'karambwan', name: 'Cooked karambwan', kind: 'karambwan', heal: 18, attackDelay: 2 },
];

export const CONSUMABLE_INDEX = new Map(CONSUMABLES.map((c) => [c.id, c] as const));
