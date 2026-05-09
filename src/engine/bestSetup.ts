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
 * because their value comes from synergy, target-type bonuses, or scaling
 * formulas — not raw offensive/strength stats:
 *
 *   Target-type bonuses (acc/dmg vs specific monster types):
 *   - Salve amulet & variants — +15-20% vs undead (0 str → scored 0)
 *   - Slayer helm (i) / Black mask (i) — +12.5-16.67% on slayer task
 *   - Berserker necklace — +20% damage with obsidian melee weapons
 *
 *   Scaling-formula weapons (DPS depends on monster stats):
 *   - Twisted bow — scales with monster magic level. Raw stats are weak
 *     (off 70, ranged_str 20) — heuristic ranks it ~12th among ranged
 *     weapons, but it's BiS at any high-magic target (Kree'arra, Olm
 *     mage hand, ToA Akkha shadow phase, etc).
 *   - Dragon hunter crossbow / lance / wand — +30/50% acc & dmg vs
 *     dragons. Base stats are decent but the synergy multiplier is what
 *     makes them BiS for Vorkath/Olm/etc.
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
  /^Twisted bow$/i,
  /^Dragon hunter (crossbow|lance|wand)$/i,
];

function shouldForceInclude(piece: EquipmentPiece): boolean {
  // Powered staves all have formula-based max hits (e.g. Tumeken's shadow
  // ×3 magic_str gear, Sanguinesti's high accuracy, Trident of the swamp's
  // floor(magic/3) base) that aren't reflected in `bonuses.magic_str` or
  // `offensive.magic`. The heuristic ranks them well below Kodai wand etc.
  // even when they're the actual BiS — Tumeken's shadow on Kree'arra was
  // the user-reported case. Include the whole category unconditionally.
  if (piece.category === 'Powered Staff') return true;
  return SYNERGY_FORCE_INCLUDE.some((re) => re.test(piece.name));
}

/**
 * Mirror the 2h⇆shield mutex that store.setSlot / picker.pickSlot enforce
 * for manual edits, but in the optimizer's slot-sweep. Without this, the
 * shield-slot iteration would happily add Twisted buckler on top of a 2h
 * weapon (Bow of Faerdhinen, Twisted bow, Scythe etc.) — calcDps doesn't
 * reject the impossible combo, it just stacks both bonuses, so the
 * optimizer routinely produced setups the game wouldn't allow.
 *
 * Normalization is one-way: 2h weapon wins, shield clears. The sweep loop
 * still gets to discover "drop the 2h weapon for a 1h + shield combo"
 * because that path is explored when iterating the WEAPON slot.
 */
function normalizeMutex(eq: PlayerLoadout['equipment']): PlayerLoadout['equipment'] {
  let out = eq;
  if (out.weapon?.isTwoHanded && out.shield) {
    out = { ...out, shield: null };
  }
  // Two-way ammo compatibility: when a weapon change makes the current ammo
  // mechanically invalid (e.g. switching from a Crossbow to a Bow leaves
  // bolts in the ammo slot), drop the ammo here. Iteration-time guards
  // handle the other direction.
  if (out.weapon && out.ammo && !ammoCompatibleWith(out.weapon, out.ammo)) {
    out = { ...out, ammo: null };
  }
  return out;
}

/**
 * Bows / crossbows / thrown weapons that don't take ammo (they generate
 * their own crystal arrows / built-in projectiles). The optimizer would
 * otherwise pair these with whatever ammo scored highest in pieceScore
 * (typically Dragon javelins or Dragon arrows), producing a visible but
 * mechanically impossible loadout.
 *
 * Crystal bow used to produce arrows from charges; in OSRS today the
 * Crystal bow uses regular arrows, so it's NOT in this list. BoF and
 * Webweaver are the standalone-ammo cases.
 */
function weaponIgnoresAmmo(weapon: EquipmentPiece | null | undefined): boolean {
  if (!weapon) return false;
  const n = weapon.name;
  return /^Bow of faerdhinen/i.test(n)
      || /^Webweaver bow/i.test(n)
      || /^Craw's bow/i.test(n);
}

/**
 * Whether a (weapon, ammo) pair is mechanically valid in OSRS:
 *   - Bows fire arrows (Twisted bow, Magic shortbow, etc.)
 *   - Crossbows fire bolts — EXCEPT ballistas, which are categorized
 *     as Crossbow but only fire javelins
 *   - Blowpipes (categorized as Thrown) take darts
 *   - Other Thrown weapons (knives, throwing axes, chinchompas) are
 *     themselves the projectile — no separate ammo
 *   - Non-ranged weapons (melee/magic) don't combine with ammo for DPS
 *     purposes; the heuristic naturally won't pick non-null ammo for
 *     them, so we allow the pairing through
 *
 * Returns true when the optimizer should be allowed to consider this pair.
 * `ammo === null` is always allowed (no ammo equipped).
 */
function ammoCompatibleWith(
  weapon: EquipmentPiece | null | undefined,
  ammo: EquipmentPiece | null | undefined,
): boolean {
  if (!ammo) return true;
  if (!weapon) return false;
  if (weaponIgnoresAmmo(weapon)) return false;

  const wname = weapon.name.toLowerCase();
  const aname = ammo.name.toLowerCase();
  const cat = (weapon.category || '').toLowerCase();

  // Ballistas (categorized as Crossbow in the data) only take javelins.
  if (/ballista/.test(wname)) return /javelin/.test(aname);
  // Blowpipes (categorized as Thrown) only take darts.
  if (/blowpipe/.test(wname)) return /dart/.test(aname);

  if (cat === 'crossbow') return /bolt/.test(aname);
  if (cat === 'bow') return /arrow/.test(aname);

  // Thrown / chinchompas / salamanders don't use a separate ammo slot
  // for projectiles.
  if (cat === 'thrown' || cat === 'chinchompas' || cat === 'salamander') return false;

  // Non-ranged weapon — pieceScore won't pick ammo for these anyway, so
  // leave the pairing alone rather than risk false rejections.
  return true;
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
  //
  // For the ammo slot, also force-include the top piece of each ammo class
  // (arrow / bolt / javelin / dart). Without this, high-ranged_str javelins
  // (Dragon javelin +150 str) crowd out the top arrow (+60 str), leaving
  // bows like Twisted bow with no compatible ammo to evaluate against — and
  // the optimizer then picks the wrong weapon class because TBow can't be
  // fairly compared with no arrows.
  for (const slot of EQUIPMENT_SLOTS) {
    const sorted = bySlot[slot].slice().sort(
      (a, b) => pieceScore(b, style, attackStyle) - pieceScore(a, style, attackStyle),
    );
    const trimmed = sorted.slice(0, shortlistPerSlot);
    const trimmedIds = new Set(trimmed.map((p) => p.id));
    for (const p of sorted) {
      if (!trimmedIds.has(p.id) && shouldForceInclude(p)) {
        trimmed.push(p);
        trimmedIds.add(p.id);
      }
    }
    if (slot === 'ammo') {
      for (const re of [/arrow/i, /bolt/i, /javelin/i, /dart/i] as const) {
        const top = sorted.find((p) => re.test(p.name) && !trimmedIds.has(p.id));
        if (top) {
          trimmed.push(top);
          trimmedIds.add(top.id);
        }
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

  /**
   * Build a candidate loadout by setting one slot, while enforcing the
   * compatibility constraints calcDps doesn't check itself:
   *  - 2h⇆shield mutex (normalizeMutex)
   *  - bow without ammo when weapon ignores ammo (BoF, Webweaver, Craw's)
   *
   * Returns null when the requested combination is invalid and the iteration
   * should skip this candidate entirely (e.g. trying to add a non-null shield
   * when the weapon is 2h, or non-null ammo when weapon is BoF). Otherwise
   * returns the normalized equipment map.
   */
  function tryEquip(
    base: PlayerLoadout,
    slot: Exclude<EquipmentSlot, '2h'>,
    piece: EquipmentPiece | null,
  ): PlayerLoadout['equipment'] | null {
    // Adding a shield over a 2h weapon is invalid — skip rather than silently
    // clear the weapon (clearing would lose progress made on the weapon slot).
    if (slot === 'shield' && piece && base.equipment.weapon?.isTwoHanded) return null;
    // Adding incompatible ammo to a weapon is invalid (BoF/Webweaver take
    // none, bows need arrows, crossbows need bolts, ballistas need
    // javelins, blowpipes need darts).
    if (slot === 'ammo' && piece && !ammoCompatibleWith(base.equipment.weapon, piece)) return null;
    let next = { ...base.equipment, [slot]: piece };
    // When evaluating a new weapon, pair it with its best compatible ammo
    // for the eval. Without this, the chicken-and-egg of slot-independent
    // iteration leaves Twisted bow / Magic shortbow / etc. evaluated with
    // no arrows (intrinsic ranged_str only) — they always lose to weapons
    // that ship arrows-built-in (BoF +106) regardless of monster scaling.
    // The shortlist is pre-sorted by pieceScore so .find returns the
    // highest-ranged-str compatible piece, which is the right pick for
    // every common bow/crossbow/ballista.
    if (slot === 'weapon' && piece && !next.ammo) {
      const bestAmmo = bySlot.ammo.find((a) => ammoCompatibleWith(piece, a));
      if (bestAmmo) next = { ...next, ammo: bestAmmo };
    }
    return normalizeMutex(next);
  }

  // Initial greedy pass
  for (const slot of EQUIPMENT_SLOTS) {
    let bestPiece: EquipmentPiece | null = null;
    let bestDps = calcDps(current, monster).dps;
    for (const piece of bySlot[slot]) {
      const eq = tryEquip(current, slot, piece);
      if (!eq) continue;
      const d = calcDps({ ...current, equipment: eq }, monster).dps;
      if (d > bestDps) {
        bestDps = d;
        bestPiece = piece;
      }
    }
    if (bestPiece) {
      const eq = tryEquip(current, slot, bestPiece);
      if (eq) current = { ...current, equipment: eq };
    }
  }

  // Refinement pass — re-sweep each slot since earlier choices may have made a
  // different later choice optimal (e.g. swap shield for off-hand once weapon is chosen).
  for (let pass = 0; pass < 2; pass++) {
    for (const slot of EQUIPMENT_SLOTS) {
      let bestPiece: EquipmentPiece | null = current.equipment[slot] ?? null;
      let bestDps = calcDps(current, monster).dps;
      // Include null (no item) option — also re-normalize for mutex (e.g.
      // dropping a 2h weapon doesn't auto-restore a shield).
      const nullEq = tryEquip(current, slot, null);
      if (nullEq) {
        const nullDps = calcDps({ ...current, equipment: nullEq }, monster).dps;
        if (nullDps > bestDps) { bestDps = nullDps; bestPiece = null; }
      }

      for (const piece of bySlot[slot]) {
        const eq = tryEquip(current, slot, piece);
        if (!eq) continue;
        const d = calcDps({ ...current, equipment: eq }, monster).dps;
        if (d > bestDps) { bestDps = d; bestPiece = piece; }
      }
      const finalEq = tryEquip(current, slot, bestPiece);
      if (finalEq) current = { ...current, equipment: finalEq };
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
