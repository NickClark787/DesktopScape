/**
 * "Best setup" optimizer. Given a player config and a monster, pick the gear
 * combination that maximises DPS. Uses a greedy per-slot search with a
 * full-combo refinement pass on the top candidates for each slot.
 */

import type {
  BestSetupCandidate,
  CombatStyle,
  EquipmentPiece,
  EquipmentSlot,
  MeleeAttackType,
  Monster,
  PlayerLoadout,
  WeaponStance,
} from '@shared/types';
import { EQUIPMENT_SLOTS } from '@shared/types';
import { calcDps, pieceScore, stancesForStyle } from './formulas';
import { CANDIDATE_SPELL_NAMES } from './spells';

/**
 * Items that the per-slot heuristic (`pieceScore`) systematically underrates
 * because their value comes from synergy or target-type bonuses, not raw
 * offensive/strength stats:
 *
 *   - Salve amulet & variants — +15-20% acc/dmg vs undead. Salve has 0 str,
 *     so it scores 0 in the heuristic and gets pruned from the neck slot.
 *     Without it, the optimizer never recommends BiS for Vorkath, Aberrant
 *     spectres, KQ, etc.
 *   - Slayer helm (i) / Black mask (i) — +12.5%-16.67% acc/dmg on slayer
 *     task. Same problem: low raw stats, big conditional damage.
 *   - Berserker necklace — +20% damage with obsidian melee weapons. No
 *     intrinsic str bonus, scores poorly.
 *
 * We splice these in unconditionally past the shortlist trim so they get
 * evaluated by the full DPS pass even at low `shortlistPerSlot`. Cheap
 * because the additional pieces are O(1) per slot.
 */
const SYNERGY_FORCE_INCLUDE: ReadonlyArray<RegExp> = [
  /^Salve amulet/i,
  /^Slayer helmet \(i\)/i,
  /^Black mask \(i\)/i,
  /^Berserker necklace( \(or\))?$/i,
];

function shouldForceInclude(piece: EquipmentPiece): boolean {
  return SYNERGY_FORCE_INCLUDE.some((re) => re.test(piece.name));
}

export interface OptimizerOptions {
  style: CombatStyle;
  attackStyle: PlayerLoadout['attackStyle'];
  shortlistPerSlot?: number;
  requireStats?: Partial<PlayerLoadout['skills']>;
  ownedOnly?: Set<number> | null;
  /** Exclude Deadman/Bounty Hunter/Leagues/quest-locked variants when true (default true). */
  excludeModeVariants?: boolean;
  /** Pin a stance instead of letting the optimizer pick. Skips the final stance sweep. */
  forceStance?: WeaponStance;
}

// Substrings on `piece.version` that indicate a game-mode variant most players can't equip.
const MODE_VARIANT_MARKERS = [
  'Deadman', 'Bounty Hunter', '(bh)', 'Leagues', 'Last Man Standing', '(lms)',
  'Nightmare Zone', 'Soul Wars', 'Barbarian Assault',
  'Broken', 'wrapped', 'perfected', 'Locked', '(max)', '(et)',
];

function isModeVariant(piece: EquipmentPiece): boolean {
  const v = `${piece.version || ''} ${piece.name || ''}`;
  return MODE_VARIANT_MARKERS.some((m) => v.includes(m));
}

function meetsStyle(piece: EquipmentPiece, style: CombatStyle): boolean {
  // A piece is eligible if it doesn't actively penalise our style too hard.
  // Cheap filter; the DPS calc is authoritative on actual value.
  if (style === 'melee' && piece.slot === 'ammo') return false;
  if (style === 'magic' && piece.slot === 'ammo') return false;
  // Ranged needs ammo slot for many bows — still allow all ammo pieces.
  return true;
}

function weaponMatchesStyle(weapon: EquipmentPiece, style: CombatStyle, attack: PlayerLoadout['attackStyle']): boolean {
  const c = weapon.category.toLowerCase();
  if (style === 'ranged') {
    return /bow|crossbow|chinchompa|thrown|dart|knive|javelin|blowpipe|salamander/i.test(c);
  }
  if (style === 'magic') {
    return /staff|wand|trident|tome|salamander/i.test(c) || weapon.offensive.magic > 0;
  }
  // melee — exclude ranged/magic-specific categories
  if (/bow|crossbow|chinchompa|staff|wand|trident|tome/i.test(c)) return false;
  // If a specific melee attack style is requested and the weapon can't do it,
  // fall back permissively (calc will assign negligible DPS).
  if (attack === 'stab' || attack === 'slash' || attack === 'crush') {
    return true;
  }
  return true;
}

export function findBestSetup(
  base: PlayerLoadout,
  monster: Monster,
  equipment: EquipmentPiece[],
  opts: OptimizerOptions,
): BestSetupCandidate | null {
  const shortlistPerSlot = opts.shortlistPerSlot ?? 4;
  const { style, attackStyle } = opts;

  // Bucket candidates by slot, keep a shortlist of top-N per slot by heuristic pieceScore.
  const bySlot: Record<string, EquipmentPiece[]> = {};
  for (const slot of EQUIPMENT_SLOTS) bySlot[slot] = [];

  const excludeVariants = opts.excludeModeVariants ?? true;
  for (const piece of equipment) {
    if (opts.ownedOnly && !opts.ownedOnly.has(piece.id)) continue;
    if (excludeVariants && isModeVariant(piece)) continue;
    if (!meetsStyle(piece, style)) continue;
    if (piece.slot === 'weapon' && !weaponMatchesStyle(piece, style, attackStyle)) continue;
    const slot = piece.slot as Exclude<EquipmentSlot, '2h'>;
    if (!bySlot[slot]) continue;
    bySlot[slot].push(piece);
  }

  // Score + trim to shortlistPerSlot per slot (plus always include "no item"
  // slot option). After trimming, splice back in any SYNERGY_FORCE_INCLUDE
  // pieces that survived the eligibility filter — see SYNERGY_FORCE_INCLUDE
  // for the rationale (Salve, Slayer helm (i), Berserker necklace etc.).
  for (const slot of EQUIPMENT_SLOTS) {
    const sorted = bySlot[slot].slice().sort(
      (a, b) => pieceScore(b, style, attackStyle) - pieceScore(a, style, attackStyle),
    );
    const trimmed = sorted.slice(0, shortlistPerSlot);
    const trimmedIds = new Set(trimmed.map((p) => p.id));
    for (const p of sorted) {
      if (!trimmedIds.has(p.id) && shouldForceInclude(p)) {
        trimmed.push(p);
      }
    }
    bySlot[slot] = trimmed;
  }

  // Start from empty, greedy fill highest-DPS item per slot, then refine by sweeping each slot
  // against its shortlist once. This gives good-enough results in ms without a full combinatorial
  // search (which for 4^11 = 4M combos would be slow).
  let current: PlayerLoadout = {
    ...base,
    style,
    attackStyle,
    stance: opts.forceStance ?? base.stance,
    equipment: {},
  };

  // Initial greedy pass
  for (const slot of EQUIPMENT_SLOTS) {
    let bestPiece: EquipmentPiece | null = null;
    let bestDps = calcDps(current, monster).dps;
    for (const piece of bySlot[slot]) {
      const candidate: PlayerLoadout = {
        ...current,
        equipment: { ...current.equipment, [slot]: piece },
      };
      const d = calcDps(candidate, monster).dps;
      if (d > bestDps) {
        bestDps = d;
        bestPiece = piece;
      }
    }
    if (bestPiece) current = { ...current, equipment: { ...current.equipment, [slot]: bestPiece } };
  }

  // Refinement pass — re-sweep each slot since earlier choices may have made a
  // different later choice optimal (e.g. swap shield for off-hand once weapon is chosen).
  for (let pass = 0; pass < 2; pass++) {
    for (const slot of EQUIPMENT_SLOTS) {
      let bestPiece: EquipmentPiece | null = current.equipment[slot] ?? null;
      let bestDps = calcDps(current, monster).dps;
      // Include null (no item) option
      const tryNull: PlayerLoadout = { ...current, equipment: { ...current.equipment, [slot]: null } };
      const nullDps = calcDps(tryNull, monster).dps;
      if (nullDps > bestDps) { bestDps = nullDps; bestPiece = null; }

      for (const piece of bySlot[slot]) {
        const candidate: PlayerLoadout = {
          ...current,
          equipment: { ...current.equipment, [slot]: piece },
        };
        const d = calcDps(candidate, monster).dps;
        if (d > bestDps) { bestDps = d; bestPiece = piece; }
      }
      current = { ...current, equipment: { ...current.equipment, [slot]: bestPiece } };
    }
  }

  // Final stance sweep: gear is fixed, pick the DPS-best stance.
  // If the caller pinned a stance, honour it and skip the sweep.
  let bestStance: WeaponStance = opts.forceStance ?? current.stance ?? 'accurate';
  let bestResult = calcDps({ ...current, stance: bestStance }, monster);
  if (!opts.forceStance) {
    for (const candidateStance of stancesForStyle(style)) {
      if (candidateStance === bestStance) continue;
      const r = calcDps({ ...current, stance: candidateStance }, monster);
      if (r.dps > bestResult.dps) {
        bestResult = r;
        bestStance = candidateStance;
      }
    }
  }

  return {
    equipment: current.equipment,
    result: bestResult,
    style,
    attackStyle,
    spell: current.spell ?? null,
    stance: bestStance,
  };
}

/**
 * For melee, run the optimizer against all three attack types and return the
 * overall winner. This matters because the best weapon+gear depends on which
 * attack roll we're using.
 */
export function findBestMeleeSetup(
  base: PlayerLoadout,
  monster: Monster,
  equipment: EquipmentPiece[],
  opts: Omit<OptimizerOptions, 'style' | 'attackStyle'> & { forceAttackStyle?: MeleeAttackType },
): BestSetupCandidate | null {
  const styles: MeleeAttackType[] = opts.forceAttackStyle ? [opts.forceAttackStyle] : ['stab', 'slash', 'crush'];
  const candidates: BestSetupCandidate[] = [];
  for (const atk of styles) {
    const c = findBestSetup(base, monster, equipment, { ...opts, style: 'melee', attackStyle: atk });
    if (c) candidates.push(c);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.result.dps - a.result.dps);
  return candidates[0];
}

/**
 * For magic, run the optimizer once per candidate spell. Powered staves ignore
 * the spell field internally, so the "best powered staff" case is covered by
 * any run. Returns the overall highest-DPS candidate, with the winning spell
 * name attached so the UI can display it.
 */
export function findBestMagicSetup(
  base: PlayerLoadout,
  monster: Monster,
  equipment: EquipmentPiece[],
  opts: Omit<OptimizerOptions, 'style' | 'attackStyle'>,
): BestSetupCandidate | null {
  const candidates: BestSetupCandidate[] = [];
  for (const spellName of CANDIDATE_SPELL_NAMES) {
    const seeded: PlayerLoadout = { ...base, spell: spellName };
    const c = findBestSetup(seeded, monster, equipment, {
      ...opts,
      style: 'magic',
      attackStyle: 'magic',
    });
    if (c) candidates.push({ ...c, spell: spellName });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.result.dps - a.result.dps);
  return candidates[0];
}
