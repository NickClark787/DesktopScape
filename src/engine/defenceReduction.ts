/**
 * Pre-fight defence draining. Applies the effect of a few opener spec hits
 * (Dragon warhammer, Elder maul, Bandos godsword, Arclight/Emberlight,
 * Accursed sceptre, Vulnerability) to the target's Defence (and Magic, for
 * Accursed) level, so the simulated DPS reflects the real fight after the
 * opener rather than the boss at full defence.
 *
 * Mechanics mirror the OSRS Wiki calculator (lib/scaling/DefenceReduction.ts):
 *  - Order: Accursed/Vulnerability → Elder maul → DWH → Arclight → Emberlight → BGS.
 *  - DWH/Elder maul take a % of the CURRENT level each hit (multiplicative).
 *  - Arclight/Emberlight subtract a flat amount per hit, based on the BASE
 *    level, larger vs demons.
 *  - BGS drains a flat number of levels (= damage dealt).
 *  - Defence is clamped at 0. (Per-boss defence floors — Akkha 70, Nex 250,
 *    etc. — are a known v1 gap; generic targets have no floor.)
 *
 * Defence drops affect melee/ranged accuracy (those rolls use Defence level);
 * magic accuracy uses the Magic level, which only Accursed lowers here.
 */
import type { DefenceReduction, FiredEffect, Monster } from '@shared/types';

export interface DefenceReductionResult {
  monster: Monster;
  effect: FiredEffect | null;
}

function isActive(r: DefenceReduction): boolean {
  return r.dwh > 0 || r.elderMaul > 0 || r.arclight > 0 || r.emberlight > 0
    || r.bgs > 0 || r.accursed || r.vulnerability;
}

function isDemon(m: Monster): boolean {
  return (m.attributes || []).some((a) => a.toLowerCase() === 'demon');
}

/** Apply the configured drain to a monster, returning a new monster + a
 *  describing effect for the UI. No-op (returns the input) when nothing is set. */
export function applyDefenceReductionDescribed(
  monsterIn: Monster,
  r: DefenceReduction | undefined,
): DefenceReductionResult {
  if (!r || !isActive(r)) return { monster: monsterIn, effect: null };

  const baseDef = monsterIn.skills.def;
  let def = baseDef;
  let magic = monsterIn.skills.magic;

  // Accursed and Vulnerability are mutually exclusive in the reference (else-if).
  if (r.accursed) {
    def = Math.trunc((def * 17) / 20);
    magic = Math.trunc((magic * 17) / 20);
  } else if (r.vulnerability) {
    def = Math.trunc((def * 9) / 10);
  }

  for (let i = 0; i < r.elderMaul; i++) def -= Math.trunc((def * 35) / 100);
  for (let i = 0; i < r.dwh; i++) def -= Math.trunc((def * 3) / 10);

  // Arclight/Emberlight: flat per-hit drain computed off the BASE defence.
  const demon = isDemon(monsterIn);
  if (r.arclight > 0) {
    const num = demon ? 2 : 1;
    def -= r.arclight * (Math.trunc((num * baseDef) / 20) + 1);
  }
  if (r.emberlight > 0) {
    const num = demon ? 3 : 1;
    def -= r.emberlight * (Math.trunc((num * baseDef) / 20) + 1);
  }

  if (r.bgs > 0) def -= r.bgs;

  def = Math.max(0, def);
  magic = Math.max(0, magic);

  const parts: string[] = [];
  if (r.accursed) parts.push('Accursed');
  if (r.vulnerability) parts.push('Vuln');
  if (r.elderMaul) parts.push(`${r.elderMaul}× Elder maul`);
  if (r.dwh) parts.push(`${r.dwh}× DWH`);
  if (r.arclight) parts.push(`${r.arclight}× Arclight`);
  if (r.emberlight) parts.push(`${r.emberlight}× Emberlight`);
  if (r.bgs) parts.push(`BGS −${r.bgs}`);

  const monster: Monster = { ...monsterIn, skills: { ...monsterIn.skills, def, magic } };
  return {
    monster,
    effect: {
      name: 'Defence reduction',
      detail: `${parts.join(', ')}: def ${baseDef}→${def}${magic !== monsterIn.skills.magic ? `, mag ${monsterIn.skills.magic}→${magic}` : ''}`,
    },
  };
}

/** Convenience: the reduced monster only. */
export function applyDefenceReduction(monster: Monster, r: DefenceReduction | undefined): Monster {
  return applyDefenceReductionDescribed(monster, r).monster;
}
