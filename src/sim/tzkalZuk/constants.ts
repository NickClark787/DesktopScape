/**
 * Numbers for the Inferno wave-69 TzKal-Zuk fight.
 *
 * Re-verified against the OSRS Wiki on 2026-08-07 (`TzKal-Zuk`, `Inferno`,
 * `Inferno/Strategies`, `Ancestral glyph`, and each Jal- monster's own page).
 * Every value below carries the page it came from. Values the wiki does
 * **not** publish — the glyph's tile width and patrol cadence, the add-set
 * spawn geometry, and the animation→land windup lengths — are modelled from
 * community strategy and marked MODELLED; they are overridable via
 * BossOptions/modifiers for drills.
 */
import type { ConsumableDef, InfernoModifier } from './types';

export const TICK_MS = 600;

// Arena — the Zuk platform. A rectangular box; x grows east, y grows north.
// Zuk occupies a 7x7 block against the north wall (wiki `TzKal-Zuk`: size
// 7x7). The player fights from the southern half, shuffling east/west with
// the glyph. MODELLED: the wiki publishes no tile dimensions for the
// platform. 25 wide is sized so a full glyph patrol takes exactly 8 Zuk
// attacks — see GLYPH_STEP_TICKS.
export const ARENA_W = 25;
export const ARENA_H = 18;
export const ZUK_SIZE = 7;

/** Wiki `TzKal-Zuk` combat box: Hitpoints 1200. */
export const ZUK_MAX_HP = 1200;

// Wiki `TzKal-Zuk`: attack speed 10 ticks (6.0s) normally, 7 ticks (4.2s)
// when enraged. Wiki `Inferno/Strategies`: the attack "cannot be protected
// from or be tick-eaten" — the glyph is the only defence.
export const ZUK_SPEED = 10;
export const ZUK_SPEED_ENRAGED = 7;

// Wiki `TzKal-Zuk`, max-hit footnote citing Mod Ash (10 July 2022): "The
// damage roll for Zuk's projectile attack consists of a single roll between
// 0 and the average of its maximum Magic hit and maximum Ranged hit. The max
// hit of the mage attack is 128, while the range attack's max hit is 169."
export const ZUK_MAGIC_MAX_HIT = 128;
export const ZUK_RANGED_MAX_HIT = 169;
/** trunc((128 + 169) / 2) = 148 — the figure the wiki's combat box shows. */
export const ZUK_MAX_HIT = Math.trunc((ZUK_MAGIC_MAX_HIT + ZUK_RANGED_MAX_HIT) / 2);

/** MODELLED: Zuk's shot is declared, then lands this many ticks later. The
 *  wiki publishes no projectile flight time. */
export const ZUK_ATTACK_DELAY = 3;

// ------------------------------------------------------------ Ancestral Glyph
//
// Wiki `Ancestral glyph`: "It can sustain TzKal-Zuk's attacks indefinitely",
// and "it has 600 hitpoints against other monsters that spawn periodically
// during the fight". Wiki `TzKal-Zuk`: "If the shield takes 600 damage, it
// will be destroyed, leaving the player fully vulnerable to Zuk's attacks."
// So: Zuk's own shots never chip the shield; only the spawned monsters do.
export const GLYPH_MAX_HP = 600;

/** MODELLED: tile width of the covered span. Not published. */
export const GLYPH_WIDTH = 5;
export const GLYPH_ROW = ZUK_SIZE + 1; // one row south of Zuk's footprint
/**
 * MODELLED cadence, chosen to satisfy a published constraint: wiki `Inferno`
 * says "TzKal-Zuk's normal attack cycle and the rotational cycle of the
 * shield align, [so] there are four consistent safespots". At 1 tile / 2
 * ticks across ARENA_W - GLYPH_WIDTH = 20 tiles, a there-and-back patrol is
 * 80 ticks = exactly 8 Zuk attacks (4 per sweep) — four consistent safespots.
 */
export const GLYPH_STEP_TICKS = 2;

// -------------------------------------------------------------- add sets
//
// Wiki `Inferno/Strategies`: "A mager and a ranger will spawn behind you
// after the shield has done a complete rotation (e.g. left → right → left).
// From here, following sets of a mager and a ranger will spawn approximately
// 3 minutes and 30 seconds after the previous set."
export const SET_INTERVAL_TICKS = 350; // 3:30 = 210s = 350 ticks
/**
 * Wiki `Inferno`: "a one-time addition of 1:45 minutes is made to the set
 * timer (which is paused between 600 and 480 Hitpoints and is resumed as
 * soon as Jad spawns)". 1:45 = 105s = 175 ticks.
 */
export const SET_PAUSE_HP = 600;
export const SET_RESUME_HP = 480;
export const SET_PAUSE_BONUS_TICKS = 175;

// ------------------------------------------------------------- the spawns
//
// Jal-Xil (wiki `Jal-Xil` / `Inferno/Strategies`): max hit 46, 125 HP,
// Magic level 90, size 3x3, attack speed 4.
export const RANGER_HP = 125;
export const RANGER_SPEED = 4;
export const RANGER_MAX_HIT = 46;
export const RANGER_SIZE = 3;

// Jal-Zek (wiki `Jal-Zek` / `Inferno/Strategies`): max hit 70 (Magic),
// 220 HP, Magic level 300, size 4x4, attack speed 4.
export const MAGER_HP = 220;
export const MAGER_SPEED = 4;
export const MAGER_MAX_HIT = 70;
export const MAGER_SIZE = 4;
/**
 * Wiki `Jal-Zek`: "Their special feature is being able to revive other
 * monsters slain on the current wave. It uses this feature only when in
 * combat and it does not attack during it (both when casting and within the
 * next seven ticks). The mager has no defined limit on how many monsters it
 * can revive, but each monster can only be revived once. They also respawn
 * with half of their normal Hitpoints, and they respawn near the centre of
 * the arena. The revived monster also has a short cooldown before it can
 * attack the player." Plus (wiki `Jal-Zek`): "it has a 1/10 chance of
 * choosing to use its respawn ability instead of performing a regular
 * attack." A Jal-Zek does NOT revive itself.
 */
export const MAGER_REVIVE_CHANCE = 0.1;
export const MAGER_REVIVE_BUSY_TICKS = 7;
/** MODELLED: the "short cooldown" before a revived monster can attack. */
export const REVIVED_ATTACK_DELAY = 4;

// JalTok-Jad (wiki `JalTok-Jad` / `Inferno/Strategies`): max hit 113, 350
// HP, Magic level 510, size 5x5, attack speed 8 on waves 67 & 69 (9 on the
// triple-Jad wave 68). Wiki `TzKal-Zuk`: "At 480 hitpoints, a JalTok-Jad
// will appear and attack the shield."
export const JAD_SPAWN_HP = 480;
export const JAD_HP = 350;
export const JAD_SPEED = 8;
export const JAD_MAX_HIT = 113;
export const JAD_SIZE = 5;
/** MODELLED: animation → landing delay. The wiki describes predicting the
 *  style from the animation but publishes no tick count. Consistent with
 *  `Inferno/Strategies` on wave 68: Jads staggered "3 ticks afterwards,
 *  resulting in a 9 tick cycle (with 3 ticks to react to each Jad)". */
export const JAD_ATTACK_DELAY = 3;

// Yt-HurKot — Jad's healers. Wiki `JalTok-Jad`: "When it reaches half of its
// health, it will spawn five Yt-HurKots"; the healer counts are 5 on wave
// 67, 3 per Jad on wave 68 and 3 on wave 69. Wiki `Inferno/Strategies`: "The
// healers use melee (with a max hit of 18)". Stats from the bundled wiki
// monster row (id 7701, `Yt-HurKot` Level 141): 90 HP, speed 4, size 1.
export const JAD_HEALER_COUNT = 3;
export const JAD_HEALER_HP = 90;
export const JAD_HEALER_SPEED = 4;
export const JAD_HEALER_MAX_HIT = 18;
/** MODELLED heal rate for Yt-HurKot; the wiki gives no number. */
export const JAD_HEAL_AMOUNT = 10;
export const JAD_HEAL_INTERVAL = 4;

// Jal-MejJak — Zuk's healers. Wiki `TzKal-Zuk`: "At 240 hitpoints, Zuk will
// become enraged … summoning four Jal-MejJaks on the lava." Wiki
// `Jal-MejJak`: 75 HP, max hit 10, attack speed 3 ticks, size 1x1, Defence
// level 100, style "Area of effect"; it "will heal TzKal-Zuk for 15-24
// hitpoints every three ticks, until the player attacks them", after which
// "they stop healing TzKal-Zuk and start raining lava balls" for 5-10 each.
export const ENRAGE_HP = 240;
export const HEALER_COUNT = 4;
export const HEALER_HP = 75;
export const HEALER_SPEED = 3;
export const HEALER_SIZE = 1;
export const HEALER_HEAL_MIN = 15;
export const HEALER_HEAL_MAX = 24; // inclusive
export const HEALER_HEAL_INTERVAL = 3;
export const HEALER_AOE_MIN = 5;
export const HEALER_AOE_MAX = 10; // inclusive; wiki `Jal-MejJak` max hit 10

/** MODELLED: animation → landing delay for the rangers and magers. */
export const ADD_ATTACK_DELAY = 2;

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

/**
 * Ranged-focused Inferno supply table. Eat delays: normal food adds three
 * ticks before the player can attack again, karambwans two (wiki `Cooked
 * karambwan`: "karambwans add a delay of two ticks before the player can
 * attack again, while most other foods have a delay of three ticks").
 */
export const CONSUMABLES: ConsumableDef[] = [
  { id: 'anglerfish', name: 'Anglerfish', kind: 'food', heal: 22, overheal: 13, attackDelay: 3 },
  { id: 'saradomin_brew', name: 'Saradomin brew', kind: 'potion', attackDelay: 3, doses: 4, healOverheal: 16 },
  { id: 'super_restore', name: 'Super restore', kind: 'potion', attackDelay: 3, doses: 4, prayerRestore: { flat: 8, perLevelNum: 1, perLevelDen: 4 } },
  { id: 'ranging_potion', name: 'Ranging potion', kind: 'potion', attackDelay: 3, doses: 4, rangedBoost: { pct: 0.1, flat: 4 } },
  { id: 'divine_ranging', name: 'Divine ranging', kind: 'potion', attackDelay: 3, doses: 4, rangedBoost: { pct: 0.1, flat: 4 }, divineTicks: 500 },
  { id: 'karambwan', name: 'Cooked karambwan', kind: 'karambwan', heal: 18, attackDelay: 2 },
];

export const CONSUMABLE_INDEX = new Map(CONSUMABLES.map((c) => [c.id, c] as const));
