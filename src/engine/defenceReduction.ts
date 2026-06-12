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
 *  - Defence is clamped at the target's drain floor: 0 for generic monsters,
 *    a per-boss minimum for raid bosses (Akkha 70, Nex 250, …), and full
 *    immunity for Verzik / Vardorvis. Floors match the reference's
 *    getDefenceFloor table. Because every drain is monotonic decreasing and
 *    the floor is constant, clamping the final value is equivalent to the
 *    reference's per-step clamping for this def-only model.
 *
 * Defence drops affect melee/ranged accuracy (those rolls use Defence level);
 * magic accuracy uses the Magic level, which only Accursed lowers here.
 */
import type { DefenceReduction, FiredEffect, Monster } from '@shared/types';

/** Per-boss minimum Defence after drains ('full' = immune to defence drain).
 *  IDs + values ported from the wiki calculator's getDefenceFloor. */
const DEFENCE_FLOORS = new Map<number, number | 'full'>();
function addFloor(ids: number[], floor: number | 'full') {
  for (const id of ids) DEFENCE_FLOORS.set(id, floor);
}
// Verzik (all phases/modes) and Vardorvis: immune to defence reduction.
addFloor([
  10830, 10831, 10832, 8369, 8370, 8371, 10847, 10848, 10849, // Verzik P1 em/norm/hm
  10833, 10834, 10835, 8372, 8373, 8374, 10850, 10851, 10852, // Verzik P2/P3
  12223, 12224, 12228, 12425, 12426, 13656, // Vardorvis
], 'full');
addFloor([8387, 8388, 10867, 10868], 100); // Sotetseg
addFloor([
  378, 9425, 9426, 9427, 9428, 9429, 9430, 9431, 9432, 9433, 9460, // Nightmare
  377, 9423, 9416, 9417, 9418, 9419, 9420, 9421, 9422, 9424, 11153, 11154, 11155, // Phosani's
], 120);
addFloor([11789, 11790, 11791, 11792, 11793, 11794, 11795, 11796], 70); // Akkha
addFloor([11778, 11779, 11780], 60); // Ba-Ba
addFloor([11719, 11721], 60); // Kephri (shielded + unshielded)
addFloor([11730, 11732, 11733], 50); // Zebak
addFloor([11761, 11763, 11762, 11764], 120); // P3 Wardens
addFloor([11751, 11750, 11752], 60); // ToA Obelisk
addFloor([11278, 11279, 11280, 11281, 11282], 250); // Nex
addFloor([13668], 90); // Araxxor
addFloor([14009, 14010, 14013, 14017, 14014], 120); // Hueycoatl
addFloor([14176], 145); // Yama

/** The lowest Defence this monster can be drained to. */
export function defenceFloor(m: Monster): number {
  const f = DEFENCE_FLOORS.get(m.id);
  if (f === 'full') return m.skills.def;
  return f ?? 0;
}

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

  const floor = defenceFloor(monsterIn);
  const floored = def < floor;
  def = Math.max(floor, def);
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
      detail: `${parts.join(', ')}: def ${baseDef}→${def}${floored ? ` (floor ${floor})` : ''}${magic !== monsterIn.skills.magic ? `, mag ${monsterIn.skills.magic}→${magic}` : ''}`,
    },
  };
}

/** Convenience: the reduced monster only. */
export function applyDefenceReduction(monster: Monster, r: DefenceReduction | undefined): Monster {
  return applyDefenceReductionDescribed(monster, r).monster;
}
