/**
 * Prayer drain math, shared between the Colosseum simulator and any future
 * sustain-aware optimizer work.
 *
 * OSRS model (https://oldschool.runescape.wiki/w/Prayer#Drain_mechanics):
 * every active prayer has a fixed "drain effect". Each game tick the active
 * effects accumulate; whenever the accumulator exceeds the player's drain
 * resistance — `2 × prayer bonus + 60` — one prayer point is lost and the
 * resistance is subtracted (remainder carries over).
 *
 * Effect values below reproduce the wiki's per-point drain intervals at +0
 * prayer bonus (e.g. Piety 1 pt / 1.2s = every 2 ticks → effect 30;
 * Protect from Melee 1 pt / 1.8s = every 3 ticks → effect 20).
 */

export type PrayerId =
  | 'piety'
  | 'chivalry'
  | 'rigour'
  | 'eagleEye'
  | 'augury'
  | 'mysticMight'
  | 'protectMelee'
  | 'protectMissiles'
  | 'protectMagic';

export const PRAYER_DRAIN_EFFECT: Record<PrayerId, number> = {
  piety: 30,
  chivalry: 24,
  rigour: 30,
  eagleEye: 20,
  augury: 30,
  mysticMight: 20,
  protectMelee: 20,
  protectMissiles: 20,
  protectMagic: 20,
};

/** Drain resistance: accumulated effect needed to lose one prayer point. */
export function drainResistance(prayerBonus: number): number {
  return 2 * prayerBonus + 60;
}

export interface PrayerDrainState {
  /** Accumulated drain effect carried between ticks. */
  accumulator: number;
}

/**
 * Advance the drain accumulator by one tick with the given prayers active.
 * Returns the number of whole prayer points lost this tick (usually 0 or 1).
 * `drainMult` scales the per-tick effect (colosseum Blasphemy-style
 * modifiers). Mutates `state.accumulator`.
 */
export function tickPrayerDrain(
  state: PrayerDrainState,
  active: Iterable<PrayerId>,
  prayerBonus: number,
  drainMult = 1,
): number {
  let effect = 0;
  for (const p of active) effect += PRAYER_DRAIN_EFFECT[p];
  if (effect === 0) return 0;
  state.accumulator += effect * drainMult;
  const resistance = drainResistance(prayerBonus);
  let lost = 0;
  while (state.accumulator >= resistance) {
    state.accumulator -= resistance;
    lost++;
  }
  return lost;
}
