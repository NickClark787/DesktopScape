import type { CombatStyle, Monster } from '@shared/types';

export const DEFAULT_STYLE_ORDER: ReadonlyArray<CombatStyle> = ['melee', 'ranged', 'magic'];

const ELEMENTAL_SPELL_WEAKNESSES = new Set(['fire', 'water', 'earth', 'air']);

/**
 * Per-style "ease of hitting" score for a monster. Lower = better (lower
 * defence means higher accuracy, which dominates DPS more than max hit does).
 *
 * Heuristic, not a full DPS sim — running the real optimizer for all three
 * styles on every monster select would be ~1s of work just to reorder three
 * tabs. Defence is the right cheap signal: it directly drives accuracy, which
 * is the dominant DPS factor at the gear levels this app targets.
 *
 * Specifics:
 * - Melee uses the lowest of stab/slash/crush, mirroring the engine's
 *   bestMeleeAttackStyle which already picks the lowest-def style.
 * - Ranged uses `standard` defence (default ammo type — heavy/light only
 *   matter for niche cases like Voidwaker spec or specific bolt/arrow tiers).
 * - Magic gets a discount when the monster has an elemental weakness, scaled
 *   by the weakness severity. The data uses fire/water/earth/air for the four
 *   elemental spells; other element strings (e.g. "none") are ignored.
 */
export function styleScores(monster: Monster): Record<CombatStyle, number> {
  const d = monster.defensive;
  const meleeDef = Math.min(d.stab, d.slash, d.crush);
  const rangedDef = d.standard;
  const magicDef = d.magic;
  const elem = monster.weakness?.element;
  const magicBoost =
    elem && ELEMENTAL_SPELL_WEAKNESSES.has(elem) ? monster.weakness?.severity ?? 0 : 0;
  return {
    melee: meleeDef,
    ranged: rangedDef,
    magic: magicDef - magicBoost,
  };
}

/**
 * Best-to-worst ordering of combat styles vs the given monster.
 *
 * When `dpsByStyle` is provided (i.e. the optimizer has been run for at
 * least one style), the ranking is by actual computed DPS, descending.
 * That's the source of truth — the defence heuristic was always a
 * shortcut for what the optimizer actually proves.
 *
 * Without DPS data we fall back to the defence heuristic from
 * `styleScores`. With no monster, the canonical melee/ranged/magic
 * order returns so the tab strip doesn't shuffle on app load.
 *
 * Sort is stable when scores tie — relative order follows input order,
 * which is DEFAULT_STYLE_ORDER. Keeps tied-DPS views from jittering.
 */
export function rankStyles(
  monster: Monster | null,
  dpsByStyle?: Partial<Record<CombatStyle, number>>,
): CombatStyle[] {
  if (!monster) return [...DEFAULT_STYLE_ORDER];
  // Prefer actual DPS when we have it for at least one style. Styles
  // without a DPS entry fall to -Infinity, sinking to the bottom.
  if (dpsByStyle && Object.keys(dpsByStyle).length > 0) {
    return [...DEFAULT_STYLE_ORDER].sort(
      (a, b) => (dpsByStyle[b] ?? -Infinity) - (dpsByStyle[a] ?? -Infinity),
    );
  }
  const scores = styleScores(monster);
  return [...DEFAULT_STYLE_ORDER].sort((a, b) => scores[a] - scores[b]);
}
