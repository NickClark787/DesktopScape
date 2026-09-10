/**
 * NPC → player combat rolls for the Inferno sim.
 *
 * The shared `calcDps` covers the player's offense (player attack roll vs
 * monster defence roll). Nothing covered the other direction, so every
 * monster attack in this sim used to be an automatic hit for a uniform
 * 0..maxHit roll. That materially overstates the damage a geared player
 * takes from Jal-Xil / Jal-Zek / JalTok-Jad.
 *
 * The formulas here are ported verbatim from the OSRS Wiki calculator
 * (`weirdgloop/osrs-dps-calc`, bundled in `.reference/`) —
 * `src/lib/NPCVsPlayerCalc.ts` (`getNPCMaxAttackRoll`, `getPlayerDefenceRoll`)
 * and `src/lib/BaseCalc.ts` (`getNormalAccuracyRoll`). Truncation points are
 * preserved exactly; OSRS rolls are integer arithmetic and rounding order
 * changes the answer.
 *
 * Max hits are NOT derived here: each Inferno monster's published wiki max
 * hit lives in `constants.ts` with its citation, because the generic
 * strength formula disagrees with the published value for several of them
 * (the reference calc special-cases the same way for magic attackers).
 */
import type { Monster, PlayerLoadout, PlayerSkills, WeaponStance } from '@shared/types';

/** The defensive stat an attack is rolled against. */
export type DefenceStyle = 'stab' | 'slash' | 'crush' | 'ranged' | 'magic';

/** Hidden defence bonus from the weapon stance (reference: getPlayerDefenceRoll). */
function stanceDefenceBonus(stance: WeaponStance | undefined): number {
  switch (stance) {
    case 'defensive':
    case 'longrange':
      return 3;
    case 'controlled':
      return 1;
    default:
      return 0;
  }
}

/** Summed equipment defence bonus for one style. */
export function playerDefensiveBonus(equipment: PlayerLoadout['equipment'], style: DefenceStyle): number {
  let total = 0;
  for (const piece of Object.values(equipment)) {
    if (piece) total += piece.defensive[style];
  }
  return total;
}

export interface PlayerDefenceInput {
  skills: PlayerSkills;
  /** Live boosts (brew defence boost, drains). */
  boosts: Pick<Record<keyof PlayerSkills, number>, 'def' | 'magic'>;
  equipment: PlayerLoadout['equipment'];
  stance: WeaponStance | undefined;
  /** Rigour is the only defence-factoring prayer this fight uses: ×125/100
   *  (reference `PrayerMap[Prayer.RIGOUR].factorDefence = [125, 100]`). */
  rigour: boolean;
}

/**
 * The player's defence roll against an attack of `style`.
 * Port of `NPCVsPlayerCalc.getPlayerDefenceRoll`.
 */
export function playerDefenceRoll(p: PlayerDefenceInput, style: DefenceStyle): number {
  let effectiveLevel = p.skills.def + p.boosts.def;
  if (p.rigour) effectiveLevel = Math.trunc((effectiveLevel * 125) / 100);

  if (style === 'magic') {
    // Magic defence blends the magic level (70%) with the defence level (30%).
    const effectiveMagic = p.skills.magic + p.boosts.magic;
    effectiveLevel = Math.trunc((effectiveMagic * 7) / 10) + Math.trunc((effectiveLevel * 3) / 10);
  }

  effectiveLevel += stanceDefenceBonus(p.stance);
  const gearBonus = playerDefensiveBonus(p.equipment, style) + 64;
  return (8 + effectiveLevel) * gearBonus;
}

/**
 * An NPC's attack roll for one style.
 * Port of `NPCVsPlayerCalc.getNPCMaxAttackRoll`.
 */
export function npcAttackRoll(monster: Monster, style: DefenceStyle): number {
  const s = monster.skills;
  const o = monster.offensive;
  switch (style) {
    case 'ranged':
      return (9 + s.ranged) * (o.ranged + 64);
    case 'magic':
      return (9 + s.magic) * (o.magic + 64);
    default:
      return (9 + s.atk) * (o.atk + 64);
  }
}

/**
 * Standard OSRS accuracy roll.
 * Port of `BaseCalc.getNormalAccuracyRoll`.
 */
export function normalAccuracy(atkIn: number, defIn: number): number {
  let atk = atkIn;
  let def = defIn;
  if (atk < 0) atk = Math.min(0, atk + 2);
  if (def < 0) def = Math.min(0, def + 2);

  if (atk >= 0 && def >= 0) {
    return atk > def ? 1 - (def + 2) / (2 * (atk + 1)) : atk / (2 * (def + 1));
  }
  if (atk >= 0 && def < 0) return 1 - 1 / (-def + 1) / (atk + 1);
  if (atk < 0 && def >= 0) return 0;
  return 1 / (-atk + 1) / (-def + 1);
}

/**
 * TzKal-Zuk's projectile is a hybrid: Mod Ash (10 July 2022, cited on the
 * `TzKal-Zuk` wiki page) — "It looks at your effective ranged defence and
 * your effective magic defence, and takes the average… It does the same for
 * the NPC's effective ranged & magic accuracy. It rolls the average accuracy
 * against the average defence."
 */
export function zukHitChance(monster: Monster, p: PlayerDefenceInput): number {
  const atk = (npcAttackRoll(monster, 'ranged') + npcAttackRoll(monster, 'magic')) / 2;
  const def = (playerDefenceRoll(p, 'ranged') + playerDefenceRoll(p, 'magic')) / 2;
  return normalAccuracy(atk, def);
}
