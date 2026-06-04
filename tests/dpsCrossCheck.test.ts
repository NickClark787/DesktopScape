/**
 * Cross-validation of the DPS engine against the official OSRS wiki calculator
 * (weirdgloop/osrs-dps-calc). Scenarios + their expected values are harvested
 * verbatim from the wiki calculator's own test suite (BasicRolls.test.ts and
 * the wiki-calc-test-caser GeneratedTests.test.ts), which are validated against
 * the live in-game numbers.
 *
 * Equipment/monster IDs match 1:1 between the two projects' bundled data
 * (verified: 5268/5268 equipment identical, monster data identical for every
 * monster used here), so a mismatch indicates a GearScape ENGINE discrepancy,
 * not a data-version difference.
 *
 * Phase 1 locks in max hit (all styles) and the attack roll (BasicRolls) by
 * direct comparison to the harvested wiki values.
 *
 * Phase 2 ("DPS from rolls") closes the loop end-to-end WITHOUT a reference
 * install: for weapons with a standard hit distribution (uniform 0..maxHit,
 * single hit, standard accuracy roll), DPS is fully determined by the
 * wiki-verified max hit + attack roll, the monster's published defence stats,
 * and the weapon speed. We recompute the NPC defence roll, hit chance, expected
 * damage and DPS straight from the canonical OSRS formulas
 * (PlayerVsNPCCalc.getNPCDefenceRoll + BaseCalc.getNormalAccuracyRoll + getDps)
 * and assert the engine matches every link. This catches accuracy / defence-roll
 * (incl. the magic-uses-magic-level rule) / speed / DPS-assembly bugs that the
 * max-hit + attack-roll checks alone cannot.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { calcDps } from '@engine/formulas';
import type {
  CombatStyle,
  EquipmentPiece,
  EquipmentSlot,
  Monster,
  AttackType,
  PlayerLoadout,
  PlayerSkills,
  Potions,
  Prayers,
  WeaponStance,
} from '@shared/types';

// ---------- Load GearScape's bundled wiki data ----------

const DATA = resolve(process.cwd(), 'resources/data');
const equipment: EquipmentPiece[] = JSON.parse(readFileSync(resolve(DATA, 'equipment.json'), 'utf8'));
const monsters: Monster[] = JSON.parse(readFileSync(resolve(DATA, 'monsters.json'), 'utf8'));

const eqById = new Map(equipment.map((e) => [e.id, e]));
const eqByName = new Map(equipment.map((e) => [e.name, e]));

function piece(ref: number | string): EquipmentPiece {
  const e = typeof ref === 'number' ? eqById.get(ref) : eqByName.get(ref);
  if (!e) throw new Error(`equipment not found: ${ref}`);
  return e;
}

function getMonster(id: number, version?: string): Monster {
  const matches = monsters.filter((m) => m.id === id);
  const m = version ? matches.find((x) => x.version === version) ?? matches[0] : matches[0];
  if (!m) throw new Error(`monster not found: ${id}`);
  return m;
}

const NO_PRAYERS: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};

type Slot = Exclude<EquipmentSlot, '2h'>;

interface Scenario {
  label: string;
  style: CombatStyle;
  attackStyle: AttackType;
  stance?: WeaponStance;
  monsterId: number;
  monsterVersion?: string;
  skills?: Partial<PlayerSkills>;
  prayers?: (keyof Prayers)[];
  potions?: Partial<Potions>;
  spell?: string | null;
  onSlayerTask?: boolean;
  inWilderness?: boolean;
  equip: Partial<Record<Slot, number | string>>;
  expect: { maxHit?: number; attackRoll?: number };
}

function buildLoadout(s: Scenario): PlayerLoadout {
  const equipment: PlayerLoadout['equipment'] = {};
  for (const [slot, ref] of Object.entries(s.equip)) {
    if (ref == null) continue;
    equipment[slot as Slot] = piece(ref);
  }
  const prayers: Prayers = { ...NO_PRAYERS };
  for (const p of s.prayers ?? []) prayers[p] = true;
  return {
    style: s.style,
    attackStyle: s.attackStyle,
    skills: { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99, ...s.skills },
    prayers,
    potions: { melee: 'none', ranged: 'none', magic: 'none', ...s.potions },
    onSlayerTask: !!s.onSlayerTask,
    inWilderness: !!s.inWilderness,
    equipment,
    spell: s.spell ?? null,
    stance: s.stance ?? 'accurate',
  };
}

// ---------- Reusable gear sets (IDs from wiki data) ----------

const MAX_MELEE = { head: 26382, cape: 21285, neck: 19553, body: 26384, shield: 22322, legs: 26386, hands: 22981, feet: 13239, ring: 11773 } as const;
const VOID_MELEE = { head: 11665, cape: 21285, neck: 19553, body: 13072, shield: 22322, legs: 13073, hands: 8842, feet: 13239, ring: 11773 } as const;
const MAX_MAGE = { head: 21018, cape: 21780, neck: 12002, body: 21021, legs: 21024, hands: 19544, feet: 13235, ring: 28313 } as const;
const VOID_MAGE = { head: 11663, cape: 21780, neck: 12002, body: 13072, legs: 13073, hands: 8842, feet: 13235, ring: 28313 } as const;

const MELEE_118 = { atk: 118, str: 118, ranged: 99, magic: 99 };
const MAGE_112 = { atk: 99, str: 99, ranged: 99, magic: 112 };

// ---------- Scenarios (verbatim from the wiki calculator's test suite) ----------

const SCENARIOS: Scenario[] = [
  // ----- BasicRolls.test.ts: clean per-style attack-roll + max-hit -----
  { label: 'BasicRolls: Abyssal whip L1 (atk)', style: 'melee', attackStyle: 'slash', monsterId: 415, skills: { atk: 1 }, equip: { weapon: 4151 }, expect: { attackRoll: 1752 } },
  { label: 'BasicRolls: Abyssal whip L1 (str)', style: 'melee', attackStyle: 'slash', monsterId: 415, skills: { str: 1 }, equip: { weapon: 4151 }, expect: { maxHit: 2 } },
  { label: 'BasicRolls: Abyssal whip L99 (atk)', style: 'melee', attackStyle: 'slash', monsterId: 415, skills: { atk: 99 }, equip: { weapon: 4151 }, expect: { attackRoll: 16060 } },
  { label: 'BasicRolls: Abyssal whip L99 (str)', style: 'melee', attackStyle: 'slash', monsterId: 415, skills: { str: 99 }, equip: { weapon: 4151 }, expect: { maxHit: 24 } },
  { label: 'BasicRolls: Bow of faerdhinen L1 (rng atk)', style: 'ranged', attackStyle: 'ranged', monsterId: 415, skills: { ranged: 1 }, equip: { weapon: 25865 }, expect: { attackRoll: 2304 } },
  { label: 'BasicRolls: Bow of faerdhinen L1 (rng str)', style: 'ranged', attackStyle: 'ranged', monsterId: 415, skills: { ranged: 1 }, equip: { weapon: 25865 }, expect: { maxHit: 3 } },
  { label: 'BasicRolls: Bow of faerdhinen L99 (rng atk)', style: 'ranged', attackStyle: 'ranged', monsterId: 415, skills: { ranged: 99 }, equip: { weapon: 25865 }, expect: { attackRoll: 21120 } },
  { label: 'BasicRolls: Bow of faerdhinen L99 (rng str)', style: 'ranged', attackStyle: 'ranged', monsterId: 415, skills: { ranged: 99 }, equip: { weapon: 25865 }, expect: { maxHit: 29 } },
  { label: 'BasicRolls: Trident of the seas L1 (mag atk)', style: 'magic', attackStyle: 'magic', monsterId: 415, skills: { magic: 1 }, equip: { weapon: 11905 }, expect: { attackRoll: 948 } },
  { label: 'BasicRolls: Trident of the seas L1 (max hit)', style: 'magic', attackStyle: 'magic', monsterId: 415, skills: { magic: 1 }, equip: { weapon: 11905 }, expect: { maxHit: 1 } },
  { label: 'BasicRolls: Trident of the seas L99 (mag atk)', style: 'magic', attackStyle: 'magic', monsterId: 415, skills: { magic: 99 }, equip: { weapon: 11905 }, expect: { attackRoll: 8690 } },
  { label: 'BasicRolls: Trident of the seas L99 (max hit)', style: 'magic', attackStyle: 'magic', monsterId: 415, skills: { magic: 99 }, equip: { weapon: 11905 }, expect: { maxHit: 28 } },

  // ----- GeneratedTests.test.ts: melee max hit -----
  { label: "Osmumten's fang in max melee", style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 415, skills: MELEE_118, prayers: ['piety'], equip: { ...MAX_MELEE, weapon: 26219 }, expect: { maxHit: 50 } },
  { label: "Osmumten's fang + salve vs Vorkath", style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 8059, skills: MELEE_118, prayers: ['piety'], equip: { ...MAX_MELEE, weapon: 26219, neck: 12018 }, expect: { maxHit: 57 } },
  { label: "Osmumten's fang + avarice vs Revenant", style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 7939, skills: { ...MELEE_118, magic: 112 }, prayers: ['piety'], equip: { ...MAX_MELEE, weapon: 26219, neck: 22557 }, expect: { maxHit: 58 } },
  { label: "Osmumten's fang + slayer helm (on task)", style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 415, skills: MELEE_118, prayers: ['piety'], onSlayerTask: true, equip: { ...MAX_MELEE, weapon: 26219, head: 11865 }, expect: { maxHit: 56 } },
  { label: "Osmumten's fang in void", style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 415, skills: MELEE_118, prayers: ['piety'], equip: { ...VOID_MELEE, weapon: 26219 }, expect: { maxHit: 47 } },
  { label: "Osmumten's fang + salve in void vs Vorkath", style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 8059, skills: MELEE_118, prayers: ['piety'], equip: { ...VOID_MELEE, weapon: 26219, neck: 12018 }, expect: { maxHit: 53 } },
  { label: 'Dragon hunter lance vs Vorkath', style: 'melee', attackStyle: 'stab', stance: 'controlled', monsterId: 8059, skills: MELEE_118, prayers: ['piety'], equip: { ...MAX_MELEE, weapon: 22978 }, expect: { maxHit: 58 } },
  { label: 'Blisterwood flail vs Vanstrom Klause', style: 'melee', attackStyle: 'crush', stance: 'aggressive', monsterId: 9567, skills: MELEE_118, prayers: ['piety'], equip: { ...MAX_MELEE, weapon: 24699 }, expect: { maxHit: 55 } },
  { label: 'Obsidian sword in obsidian armour', style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 415, skills: MELEE_118, prayers: ['piety'], equip: { ...MAX_MELEE, head: 21298, weapon: 6523, body: 21301, legs: 21304 }, expect: { maxHit: 46 } },
  { label: 'Obsidian sword + salve vs Vorkath', style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 8059, skills: MELEE_118, prayers: ['piety'], equip: { ...MAX_MELEE, head: 21298, weapon: 6523, body: 21301, legs: 21304, neck: 12018 }, expect: { maxHit: 52 } },
  { label: 'Obsidian sword + avarice vs Revenant', style: 'melee', attackStyle: 'stab', stance: 'aggressive', monsterId: 7939, skills: { ...MELEE_118, magic: 112 }, prayers: ['piety'], equip: { ...MAX_MELEE, head: 21298, weapon: 6523, body: 21301, legs: 21304, neck: 22557 }, expect: { maxHit: 53 } },
  { label: "Viggora's chainmace in max melee (wildy)", style: 'melee', attackStyle: 'crush', stance: 'aggressive', monsterId: 415, skills: MELEE_118, prayers: ['piety'], inWilderness: true, equip: { ...MAX_MELEE, weapon: 22545 }, expect: { maxHit: 73 } },
  { label: "Viggora's chainmace in void (wildy)", style: 'melee', attackStyle: 'crush', stance: 'aggressive', monsterId: 415, skills: MELEE_118, prayers: ['piety'], inWilderness: true, equip: { ...VOID_MELEE, weapon: 22545 }, expect: { maxHit: 67 } },
  { label: "Viggora's chainmace + avarice (wildy)", style: 'melee', attackStyle: 'crush', stance: 'aggressive', monsterId: 7939, skills: { ...MELEE_118, magic: 112 }, prayers: ['piety'], inWilderness: true, equip: { ...MAX_MELEE, weapon: 22545, neck: 22557 }, expect: { maxHit: 85 } },
  { label: "Viggora's chainmace + avarice in void (wildy)", style: 'melee', attackStyle: 'crush', stance: 'aggressive', monsterId: 7939, skills: { ...MELEE_118, magic: 112 }, prayers: ['piety'], inWilderness: true, equip: { ...VOID_MELEE, weapon: 22545, neck: 22557 }, expect: { maxHit: 78 } },

  // ----- GeneratedTests.test.ts: magic max hit -----
  { label: "Tumeken's shadow in max mage", style: 'magic', attackStyle: 'magic', monsterId: 415, skills: MAGE_112, equip: { ...MAX_MAGE, weapon: 27275 }, expect: { maxHit: 65 } },
  { label: "Tumeken's shadow + salve vs Vorkath", style: 'magic', attackStyle: 'magic', monsterId: 8059, skills: MAGE_112, equip: { ...MAX_MAGE, weapon: 27275, neck: 12018 }, expect: { maxHit: 67 } },
  { label: "Tumeken's shadow + slayer helm (on task)", style: 'magic', attackStyle: 'magic', monsterId: 415, skills: MAGE_112, onSlayerTask: true, equip: { ...MAX_MAGE, weapon: 27275, head: 11865 }, expect: { maxHit: 70 } },
  { label: "Tumeken's shadow in void", style: 'magic', attackStyle: 'magic', monsterId: 415, skills: MAGE_112, equip: { ...VOID_MAGE, weapon: 27275 }, expect: { maxHit: 51 } },
  { label: "Tumeken's shadow + salve in void vs Vorkath", style: 'magic', attackStyle: 'magic', monsterId: 8059, skills: { atk: 118, str: 118, ranged: 99, magic: 112 }, equip: { ...VOID_MAGE, weapon: 27275, neck: 12018 }, expect: { maxHit: 53 } },
  { label: 'Bone staff in max mage vs Scurrius', style: 'magic', attackStyle: 'magic', monsterId: 7222, skills: MAGE_112, equip: { ...MAX_MAGE, weapon: 28796, shield: 25985 }, expect: { maxHit: 53 } },
  { label: 'Bone staff + slayer helm (on task)', style: 'magic', attackStyle: 'magic', monsterId: 1680, skills: MAGE_112, onSlayerTask: true, equip: { ...MAX_MAGE, weapon: 28796, shield: 25985, head: 11865 }, expect: { maxHit: 59 } },
  { label: 'Bone staff in void vs Scurrius', style: 'magic', attackStyle: 'magic', monsterId: 7222, skills: MAGE_112, equip: { ...VOID_MAGE, weapon: 28796, shield: 25985 }, expect: { maxHit: 49 } },
  { label: 'Fire Bolt + chaos gauntlets', style: 'magic', attackStyle: 'magic', monsterId: 415, skills: MAGE_112, spell: 'Fire Bolt', equip: { ...MAX_MAGE, weapon: 11791, shield: 25985, hands: 777 }, expect: { maxHit: 20 } },
  { label: 'Fire Bolt + chaos gauntlets + salve', style: 'magic', attackStyle: 'magic', monsterId: 8059, skills: MAGE_112, spell: 'Fire Bolt', equip: { ...MAX_MAGE, weapon: 11791, shield: 25985, hands: 777, neck: 12018 }, expect: { maxHit: 28 } },
  { label: 'Fire Bolt + chaos gauntlets + tome of fire', style: 'magic', attackStyle: 'magic', monsterId: 415, skills: MAGE_112, spell: 'Fire Bolt', equip: { ...MAX_MAGE, weapon: 11791, shield: 20714, hands: 777 }, expect: { maxHit: 22 } },
  { label: 'Fire Bolt + chaos gauntlets + salve + tome of fire', style: 'magic', attackStyle: 'magic', monsterId: 8059, skills: MAGE_112, spell: 'Fire Bolt', equip: { ...MAX_MAGE, weapon: 11791, shield: 20714, hands: 777, neck: 12018 }, expect: { maxHit: 30 } },
];

// ---------- Run + collect ----------

interface Row {
  s: Scenario;
  monsterName: string;
  weaponName: string;
  maxHit: number;
  attackRoll: number;
  accuracy: number;
  dps: number;
  error?: string;
}

const ROWS: Row[] = SCENARIOS.map((s) => {
  try {
    const monster = getMonster(s.monsterId, s.monsterVersion);
    const loadout = buildLoadout(s);
    const r = calcDps(loadout, monster);
    return {
      s,
      monsterName: `${monster.name}${monster.version ? `/${monster.version}` : ''}`,
      weaponName: loadout.equipment.weapon?.name ?? '(none)',
      maxHit: r.maxHit,
      attackRoll: r.details.attackRoll,
      accuracy: r.accuracy,
      dps: r.dps,
    };
  } catch (e) {
    return { s, monsterName: '?', weaponName: '?', maxHit: NaN, attackRoll: NaN, accuracy: NaN, dps: NaN, error: (e as Error).message };
  }
});

interface Check { label: string; metric: 'maxHit' | 'attackRoll'; gs: number; exp: number; row: Row }
const CHECKS: Check[] = [];
for (const row of ROWS) {
  if (row.error) continue;
  if (row.s.expect.maxHit !== undefined) CHECKS.push({ label: `${row.s.label} [maxHit]`, metric: 'maxHit', gs: row.maxHit, exp: row.s.expect.maxHit, row });
  if (row.s.expect.attackRoll !== undefined) CHECKS.push({ label: `${row.s.label} [attackRoll]`, metric: 'attackRoll', gs: row.attackRoll, exp: row.s.expect.attackRoll, row });
}

// ---------- Phase 2: DPS from first principles ----------
//
// Canonical OSRS formulas, reimplemented here independently of the engine so a
// match is a genuine cross-check rather than a tautology.

/** NPC defence roll = (level + 9) × (defensive bonus + 64). For magic attacks,
 *  `level` is the monster's MAGIC level (PlayerVsNPCCalc.getNPCDefenceRoll). */
function npcDefenceRoll(level: number, defBonus: number): number {
  return (level + 9) * (defBonus + 64);
}

/** Standard accuracy roll (BaseCalc.getNormalAccuracyRoll, non-negative case). */
function normalHitChance(atk: number, def: number): number {
  return atk > def ? 1 - (def + 2) / (2 * (atk + 1)) : atk / (2 * (def + 1));
}

const SECONDS_PER_TICK = 0.6;
const ABYSSAL_DEMON = 415; // def 135 / magic 1; all melee+ranged def bonuses = 20, magic def = 0

interface FpScenario {
  label: string;
  build: Scenario;
  defLevel: number; // monster level used for THIS style's defence roll (magic level for magic)
  defBonus: number; // monster defensive bonus for the attack type
  speedTicks: number; // weapon speed in ticks at the scenario's stance
  maxHit: number; // wiki-verified (Phase 1)
  attackRoll: number; // wiki-verified (Phase 1)
}

// One clean, standard-distribution weapon per style. maxHit/attackRoll are the
// same wiki-validated BasicRolls values asserted in Phase 1.
const FP_SCENARIOS: FpScenario[] = [
  {
    label: 'Abyssal whip L99 vs Abyssal demon (melee/slash)',
    build: { label: 'fp-whip', style: 'melee', attackStyle: 'slash', monsterId: ABYSSAL_DEMON, equip: { weapon: 4151 }, expect: {} },
    defLevel: 135, defBonus: 20, speedTicks: 4, maxHit: 24, attackRoll: 16060,
  },
  {
    label: 'Bow of faerdhinen L99 vs Abyssal demon (ranged, accurate)',
    build: { label: 'fp-bof', style: 'ranged', attackStyle: 'ranged', monsterId: ABYSSAL_DEMON, equip: { weapon: 25865 }, expect: {} },
    defLevel: 135, defBonus: 20, speedTicks: 5, maxHit: 29, attackRoll: 21120,
  },
  {
    label: 'Trident of the seas L99 vs Abyssal demon (magic; uses magic level)',
    build: { label: 'fp-trident', style: 'magic', attackStyle: 'magic', monsterId: ABYSSAL_DEMON, equip: { weapon: 11905 }, expect: {} },
    defLevel: 1, defBonus: 0, speedTicks: 4, maxHit: 28, attackRoll: 8690,
  },
];

interface FpRow {
  fp: FpScenario;
  gs: { maxHit: number; attackRoll: number; defenceRoll: number; accuracy: number; avgHit: number; ticks: number; dps: number };
  exp: { defenceRoll: number; accuracy: number; avgHit: number; dps: number };
}

const FP_ROWS: FpRow[] = FP_SCENARIOS.map((fp) => {
  const monster = getMonster(fp.build.monsterId);
  const r = calcDps(buildLoadout(fp.build), monster);
  const defenceRoll = npcDefenceRoll(fp.defLevel, fp.defBonus);
  const accuracy = normalHitChance(fp.attackRoll, defenceRoll);
  const avgHit = accuracy * (fp.maxHit / 2);
  const dps = avgHit / (fp.speedTicks * SECONDS_PER_TICK);
  return {
    fp,
    gs: { maxHit: r.maxHit, attackRoll: r.details.attackRoll, defenceRoll: r.details.defenceRoll, accuracy: r.accuracy, avgHit: r.avgHit, ticks: r.weaponSpeedTicks, dps: r.dps },
    exp: { defenceRoll, accuracy, avgHit, dps },
  };
});

// ---------- Report ----------

afterAll(() => {
  const pad = (v: unknown, n: number) => String(v).padEnd(n);
  const padL = (v: unknown, n: number) => String(v).padStart(n);
  const lines: string[] = [];
  lines.push('');
  lines.push('='.repeat(120));
  lines.push('DPS ENGINE CROSS-CHECK vs official OSRS wiki calculator (weirdgloop/osrs-dps-calc)');
  lines.push('='.repeat(120));
  lines.push(`${pad('Style', 7)} ${pad('Scenario', 46)} ${pad('Metric', 10)} ${padL('GearScape', 11)} ${padL('Correct', 9)} ${padL('Δ', 7)}  Status`);
  lines.push('-'.repeat(120));
  let fails = 0;
  for (const c of CHECKS) {
    const delta = c.gs - c.exp;
    const ok = delta === 0;
    if (!ok) fails++;
    lines.push(
      `${pad(c.row.s.style, 7)} ${pad(c.row.s.label.slice(0, 46), 46)} ${pad(c.metric, 10)} ${padL(c.gs, 11)} ${padL(c.exp, 9)} ${padL(delta > 0 ? `+${delta}` : delta, 7)}  ${ok ? 'OK' : 'FAIL'}`,
    );
  }
  lines.push('-'.repeat(120));
  const errs = ROWS.filter((r) => r.error);
  for (const r of errs) lines.push(`ERROR  ${r.s.label}: ${r.error}`);
  lines.push(`PHASE 1 (max hit + attack roll): ${CHECKS.length} checks, ${CHECKS.length - fails} passed, ${fails} failed${errs.length ? `, ${errs.length} scenario build errors` : ''}`);
  lines.push('');

  // Phase 2: DPS reconstructed from rolls + monster defence + speed.
  lines.push('='.repeat(120));
  lines.push('PHASE 2: DPS FROM FIRST PRINCIPLES (defence roll + hit chance + expected damage + DPS, independent of engine internals)');
  lines.push('='.repeat(120));
  lines.push(`${pad('Scenario', 58)} ${pad('Metric', 11)} ${padL('GearScape', 13)} ${padL('Derived', 13)} ${padL('Δ', 11)}  Status`);
  lines.push('-'.repeat(120));
  let fp2Fails = 0;
  const fpMetric = (label: string, gs: number, exp: number, dp: number, exact: boolean) => {
    const delta = gs - exp;
    const ok = exact ? delta === 0 : Math.abs(delta) < 1e-6;
    if (!ok) fp2Fails++;
    lines.push(
      `${pad('', 58)} ${pad(label, 11)} ${padL(gs.toFixed(dp), 13)} ${padL(exp.toFixed(dp), 13)} ${padL(delta.toFixed(dp), 11)}  ${ok ? 'OK' : 'FAIL'}`,
    );
  };
  for (const fr of FP_ROWS) {
    lines.push(`${pad(fr.fp.label.slice(0, 58), 58)} ${pad(`def L${fr.fp.defLevel}/+${fr.fp.defBonus} ${fr.fp.speedTicks}t  max ${fr.fp.maxHit} / atk ${fr.fp.attackRoll}`, 60)}`);
    fpMetric('defRoll', fr.gs.defenceRoll, fr.exp.defenceRoll, 0, true);
    fpMetric('accuracy', fr.gs.accuracy, fr.exp.accuracy, 6, false);
    fpMetric('avgHit', fr.gs.avgHit, fr.exp.avgHit, 6, false);
    fpMetric('dps', fr.gs.dps, fr.exp.dps, 6, false);
  }
  lines.push('-'.repeat(120));
  lines.push(`PHASE 2 (DPS from rolls): ${FP_ROWS.length * 4} checks, ${FP_ROWS.length * 4 - fp2Fails} passed, ${fp2Fails} failed`);
  lines.push('='.repeat(120));

  const report = lines.join('\n');
  // eslint-disable-next-line no-console
  console.log(report);
  // Persist the comparison report as a reviewable artifact (the requested deliverable).
  try {
    writeFileSync(resolve(process.cwd(), 'tests/dps-cross-check-report.txt'), `${report}\n`);
  } catch {
    /* read-only FS in some CI sandboxes — console output is the fallback */
  }
});

describe('DPS engine cross-check vs wiki calculator', () => {
  it.each(CHECKS)('$label', (c) => {
    expect(c.gs).toBe(c.exp);
  });

  it('all scenarios built without error', () => {
    const errs = ROWS.filter((r) => r.error).map((r) => `${r.s.label}: ${r.error}`);
    expect(errs).toEqual([]);
  });
});

describe('DPS from rolls (first-principles, no reference install)', () => {
  it.each(FP_ROWS)('$fp.label', (fr) => {
    // (1) Engine reproduces the wiki-verified rolls for this exact loadout.
    expect(fr.gs.maxHit).toBe(fr.fp.maxHit);
    expect(fr.gs.attackRoll).toBe(fr.fp.attackRoll);
    // (2) Engine's defence roll + speed match the canonical inputs exactly.
    expect(fr.gs.defenceRoll).toBe(fr.exp.defenceRoll);
    expect(fr.gs.ticks).toBe(fr.fp.speedTicks);
    // (3) Accuracy, expected damage and DPS match the independent derivation.
    expect(fr.gs.accuracy).toBeCloseTo(fr.exp.accuracy, 6);
    expect(fr.gs.avgHit).toBeCloseTo(fr.exp.avgHit, 6);
    expect(fr.gs.dps).toBeCloseTo(fr.exp.dps, 6);
  });
});
