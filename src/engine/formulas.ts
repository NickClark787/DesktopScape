/**
 * OSRS combat formulas. Derived from Bitterkoekje's public research and the
 * open-source weirdgloop/osrs-dps-calc (GPL-3.0). Covers melee / ranged /
 * magic core DPS — boss-specific mechanics (CoX/ToB scaling, Verzik, etc.)
 * are not applied here.
 */

import type {
  CalcResult,
  CombatStyle,
  EquipmentPiece,
  FiredEffect,
  Monster,
  PlayerLoadout,
  PlayerSkills,
  Potions,
  Prayers,
  StyleStats,
  WeaponStance,
} from '@shared/types';
import {
  allowsSpellCasting,
  getSpellMaxHit,
  isPoweredStaff,
  isSalamander,
  poweredStaffMaxHit,
  shadowDamageMultiplier,
  spellByName,
} from './spells';
import { applyRaidScalingDescribed } from './raidScaling';
import {
  berserkerNeckBonus,
  boltProcName,
  chaosGauntletsBonus,
  colossalBladeBonus,
  crystalArmourBonus,
  demonbaneMult,
  dragonHunterMult,
  efaritayAccuracyBonus,
  harmonisedSpeedOverride,
  inquisitorBonus,
  bloodMoonSpeedReduction,
  eclipseMoonBurnAvgPerSwing,
  isDualMacuahuitl,
  isEclipseAtlatl,
  isScythe,
  kerisBonus,
  kerisSunAccBoostMult,
  magicWeaponMult,
  obsidianArmourBonus,
  scorchingBowMult,
  specialAvgPerSwing,
  targetTypeBonus,
  twistedBowMult,
  vampyreWeaponBonus,
  virtusBonus,
  voidBonus,
  wildernessWeaponBonus,
} from './weaponEffects';

// ---------- Fired-effect collector ----------

interface MultPair { dmgMult: number; accMult: number }

function pct(x: number, sign = false): string {
  const delta = (x - 1) * 100;
  const s = delta >= 0 ? '+' : '';
  return `${sign ? s : ''}${delta.toFixed(delta % 1 === 0 ? 0 : 1)}%`;
}

function describeMult(m: MultPair): string {
  const parts: string[] = [];
  if (m.dmgMult !== 1) parts.push(`${pct(m.dmgMult, true)} dmg`);
  if (m.accMult !== 1) parts.push(`${pct(m.accMult, true)} acc`);
  return parts.join(', ');
}

function pushIfFired(out: FiredEffect[], name: string, m: MultPair, suffix = ''): void {
  if (m.dmgMult === 1 && m.accMult === 1) return;
  out.push({ name, detail: describeMult(m) + (suffix ? ` ${suffix}` : '') });
}

const SECONDS_PER_TICK = 0.6;

// ---------- Potion boosts ----------

function potionAttack(p: Potions['melee'], atk: number): number {
  switch (p) {
    case 'attack':      return Math.floor(atk * 0.10) + 3;
    case 'super_attack':return Math.floor(atk * 0.15) + 5;
    case 'combat':      return Math.floor(atk * 0.10) + 3;
    case 'super_combat':return Math.floor(atk * 0.15) + 5;
    case 'overload':    return Math.floor(atk * 0.16) + 6;
    default:            return 0;
  }
}
function potionStrength(p: Potions['melee'], str: number): number {
  switch (p) {
    case 'strength':    return Math.floor(str * 0.10) + 3;
    case 'super_strength':return Math.floor(str * 0.15) + 5;
    case 'combat':      return Math.floor(str * 0.10) + 3;
    case 'super_combat':return Math.floor(str * 0.15) + 5;
    case 'overload':    return Math.floor(str * 0.16) + 6;
    default:            return 0;
  }
}
function potionRanged(p: Potions['ranged'], r: number): number {
  switch (p) {
    case 'ranging':         return Math.floor(r * 0.10) + 4;
    case 'super_ranging':   return Math.floor(r * 0.15) + 5;
    case 'divine_ranging':  return Math.floor(r * 0.15) + 5;
    case 'overload':        return Math.floor(r * 0.16) + 6;
    default:                return 0;
  }
}
function potionMagic(p: Potions['magic'], m: number): number {
  switch (p) {
    case 'magic':           return 4;
    case 'imbued_heart':    return Math.floor(m * 0.10) + 1;
    case 'saturated_heart': return Math.floor(m * 0.13) + 4;
    case 'ancient_brew':    return Math.floor(m * 0.05) + 2;
    case 'forgotten_brew':  return Math.floor(m * 0.08) + 3;
    case 'overload':        return Math.floor(m * 0.16) + 6;
    default:                return 0;
  }
}

// ---------- Prayer modifiers ----------

interface PrayerMults {
  atk: number;
  str: number;
  ranged: number;
  rangedStr: number;
  magic: number;
  def: number;
}

function prayerMultipliers(pr: Prayers): PrayerMults {
  const m: PrayerMults = { atk: 1, str: 1, ranged: 1, rangedStr: 1, magic: 1, def: 1 };

  // Melee attack
  if (pr.clarityOfThought) m.atk = Math.max(m.atk, 1.05);
  if (pr.improvedReflexes) m.atk = Math.max(m.atk, 1.10);
  if (pr.incredibleReflexes) m.atk = Math.max(m.atk, 1.15);
  if (pr.chivalry) m.atk = Math.max(m.atk, 1.15);
  if (pr.piety) m.atk = Math.max(m.atk, 1.20);
  // Melee strength
  if (pr.burstOfStrength) m.str = Math.max(m.str, 1.05);
  if (pr.superhumanStrength) m.str = Math.max(m.str, 1.10);
  if (pr.ultimateStrength) m.str = Math.max(m.str, 1.15);
  if (pr.chivalry) m.str = Math.max(m.str, 1.18);
  if (pr.piety) m.str = Math.max(m.str, 1.23);

  // Ranged
  if (pr.sharpEye) { m.ranged = Math.max(m.ranged, 1.05); m.rangedStr = Math.max(m.rangedStr, 1.05); }
  if (pr.hawkEye) { m.ranged = Math.max(m.ranged, 1.10); m.rangedStr = Math.max(m.rangedStr, 1.10); }
  if (pr.eagleEye) { m.ranged = Math.max(m.ranged, 1.15); m.rangedStr = Math.max(m.rangedStr, 1.15); }
  if (pr.rigour) { m.ranged = Math.max(m.ranged, 1.20); m.rangedStr = Math.max(m.rangedStr, 1.23); m.def = Math.max(m.def, 1.25); }

  // Magic — accuracy multiplicative only. No standard prayer in OSRS gives
  // magic damage; the Mystic line and Augury boost magic accuracy (and
  // Augury also magic defence), but damage comes exclusively from gear
  // (magic_str) and items like Imbued Heart. Earlier code attributed
  // +1/2/4% magic damage to Mystic Lore/Might/Augury — that was incorrect
  // and silently inflated every magic max hit while those prayers were on.
  if (pr.mysticWill) { m.magic = Math.max(m.magic, 1.05); }
  if (pr.mysticLore) { m.magic = Math.max(m.magic, 1.10); }
  if (pr.mysticMight) { m.magic = Math.max(m.magic, 1.15); }
  if (pr.augury) { m.magic = Math.max(m.magic, 1.25); m.def = Math.max(m.def, 1.25); }

  return m;
}

// ---------- Equipment summation ----------

export interface SummedEquipment {
  bonuses: { str: number; ranged_str: number; magic_str: number; prayer: number };
  offensive: StyleStats;
  defensive: StyleStats;
  weaponSpeed: number;
  weaponCategory: string | null;
}

export function sumEquipment(eq: PlayerLoadout['equipment']): SummedEquipment {
  const sum: SummedEquipment = {
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 },
    weaponSpeed: 4,
    weaponCategory: null,
  };
  for (const piece of Object.values(eq)) {
    if (!piece) continue;
    sum.bonuses.str += piece.bonuses.str;
    sum.bonuses.ranged_str += piece.bonuses.ranged_str;
    sum.bonuses.magic_str += piece.bonuses.magic_str;
    sum.bonuses.prayer += piece.bonuses.prayer;
    (['stab','slash','crush','magic','ranged'] as const).forEach((k) => {
      sum.offensive[k] += piece.offensive[k];
      sum.defensive[k] += piece.defensive[k];
    });
    if (piece.slot === 'weapon') {
      sum.weaponSpeed = piece.speed;
      sum.weaponCategory = piece.category;
    }
  }
  return sum;
}

// ---------- Style bonuses from stance ----------

interface StanceBonus {
  atk: number;   // +attack level
  str: number;   // +strength level
  def: number;
  ranged: number;
  magic: number;
}

function stanceBonus(style: CombatStyle, stance: WeaponStance): StanceBonus {
  // OSRS: the weapon's chosen attack stance adds hidden levels.
  // "accurate" → +3 to atk (or ranged/magic), "aggressive" → +3 str, "controlled" → +1 to all, "defensive" → +3 def.
  const bonus: StanceBonus = { atk: 0, str: 0, def: 0, ranged: 0, magic: 0 };
  if (style === 'melee') {
    if (stance === 'accurate') bonus.atk = 3;
    else if (stance === 'aggressive') bonus.str = 3;
    else if (stance === 'controlled') { bonus.atk = 1; bonus.str = 1; bonus.def = 1; }
    else if (stance === 'defensive') bonus.def = 3;
  } else if (style === 'ranged') {
    if (stance === 'accurate') bonus.ranged = 3;
    // 'rapid' gives no stat bonus but a faster weapon speed (handled below).
    else if (stance === 'longrange') bonus.def = 3;
  } else if (style === 'magic') {
    // 'accurate' adds +3 magic; 'longrange' adds +1 def and +3 magic. 'defensive casting' adds +3 def.
    bonus.magic = 3;
  }
  return bonus;
}

/**
 * Valid stances for a given style. "rapid" is only meaningful for ranged
 * weapons (shaves a tick off the swing). The optimizer iterates these to
 * pick the DPS-best stance per gear set.
 */
export function stancesForStyle(style: CombatStyle): WeaponStance[] {
  if (style === 'melee') return ['accurate', 'aggressive', 'controlled'];
  if (style === 'ranged') return ['accurate', 'rapid'];
  return ['accurate'];
}

/** Categories where 'rapid' stance reduces weapon speed by 1 tick. */
const RAPID_REDUCES_SPEED = /bow|crossbow|chinchompa|thrown|dart|knive|javelin|blowpipe/i;

/** Returns weapon speed in ticks after applying stance-specific adjustments. */
function stanceWeaponSpeed(baseSpeed: number, style: CombatStyle, stance: WeaponStance, weapon: EquipmentPiece | null): number {
  if (style === 'ranged' && stance === 'rapid' && weapon && RAPID_REDUCES_SPEED.test(weapon.category)) {
    return Math.max(1, baseSpeed - 1);
  }
  return baseSpeed;
}

// ---------- Core DPS calc ----------

export function calcDps(loadout: PlayerLoadout, monsterIn: Monster): CalcResult {
  const effects: FiredEffect[] = [];

  // Raid scaling: inflate HP/atk/def of the monster before any rolls. Engine
  // sees the scaled monster, so accuracy reflects scaled defence (ToA) and
  // TTK reflects scaled HP.
  const scaled = applyRaidScalingDescribed(monsterIn, loadout.raidScaling);
  const monster = scaled.monster;
  if (scaled.effect) effects.push(scaled.effect);
  const eq = sumEquipment(loadout.equipment);
  const pr = prayerMultipliers(loadout.prayers);
  const sk: PlayerSkills = { ...loadout.skills };
  const { style } = loadout;
  const weapon = loadout.equipment.weapon ?? null;

  // Apply potion boosts to a copy
  if (style === 'melee') {
    sk.atk += potionAttack(loadout.potions.melee, sk.atk);
    sk.str += potionStrength(loadout.potions.melee, sk.str);
  } else if (style === 'ranged') {
    sk.ranged += potionRanged(loadout.potions.ranged, sk.ranged);
  } else {
    sk.magic += potionMagic(loadout.potions.magic, sk.magic);
  }

  const selectedStance: WeaponStance = loadout.stance ?? 'accurate';
  const stance = stanceBonus(style, selectedStance);

  let effectiveAttack = 0;
  let effectiveStrength = 0;
  let attackRoll = 0;
  let defenceRoll = 0;
  let maxHit = 0;

  if (style === 'melee') {
    effectiveAttack = Math.floor(sk.atk * pr.atk) + stance.atk + 8;
    effectiveStrength = Math.floor(sk.str * pr.str) + stance.str + 8;

    const atkStyle = loadout.attackStyle === 'stab' ? eq.offensive.stab
      : loadout.attackStyle === 'slash' ? eq.offensive.slash
      : eq.offensive.crush;

    attackRoll = effectiveAttack * (atkStyle + 64);
    maxHit = Math.floor(0.5 + (effectiveStrength * (eq.bonuses.str + 64)) / 640);

    const defStyle = loadout.attackStyle === 'stab' ? monster.defensive.stab
      : loadout.attackStyle === 'slash' ? monster.defensive.slash
      : monster.defensive.crush;
    defenceRoll = (monster.skills.def + 9) * (defStyle + 64);

    // Flying targets (Kree'arra, Aviansie, Smoke devil) can't be reached by
    // most melee weapons — every attack misses. Halberds are the exception:
    // their 2-tile reach lets them hit flying creatures from outside melee
    // range, which is the canonical "melee Kree'arra" setup. Polearm
    // category covers all halberds (Bronze through Noxious / Crystal /
    // Corrupted), and contains no non-halberd entries in the data.
    if ((monster.attributes || []).some((a) => a.toLowerCase() === 'flying')) {
      const isHalberd = weapon?.category === 'Polearm';
      if (!isHalberd) {
        maxHit = 0;
        attackRoll = 0;
        effects.push({ name: 'Flying target', detail: `${monster.name} can only be meleed with a halberd` });
      } else {
        effects.push({ name: 'Halberd reach', detail: `${monster.name} hit at 2-tile range` });
      }
    }

    // Demonbane weapons (Arclight / Emberlight / Darklight) vs demons.
    const dm = demonbaneMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dm.dmgMult);
    attackRoll = Math.trunc(attackRoll * dm.accMult);
    if (weapon) pushIfFired(effects, weapon.name, dm, 'vs demon');

    // Inquisitor's armour — +0.5% per piece, +2.5% full set, crush only.
    const iq = inquisitorBonus(loadout.equipment, loadout.attackStyle);
    maxHit = Math.trunc(maxHit * iq.dmgMult);
    attackRoll = Math.trunc(attackRoll * iq.accMult);
    pushIfFired(effects, "Inquisitor's set", iq, '(crush)');

    // Void Knight / Elite Void — melee helm set.
    const vm = voidBonus(loadout.equipment, 'melee');
    maxHit = Math.trunc(maxHit * vm.dmgMult);
    attackRoll = Math.trunc(attackRoll * vm.accMult);
    pushIfFired(effects, 'Void (melee)', vm);

    // Keris / Keris partisan vs kalphite/scarab — +33% dmg (partisans) & acc
    // (corruption). 1/51 triple-damage proc applied to avg later.
    const kb = kerisBonus(weapon, monster);
    maxHit = Math.trunc(maxHit * kb.dmgMult);
    attackRoll = Math.trunc(attackRoll * kb.accMult);
    if (weapon) pushIfFired(effects, weapon.name, kb, 'vs kalphite/scarab');

    // Dragon hunter lance vs dragons.
    const dh = dragonHunterMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dh.dmgMult);
    attackRoll = Math.trunc(attackRoll * dh.accMult);
    if (weapon) pushIfFired(effects, weapon.name, dh, 'vs dragon');

    // Obsidian armour set + Berserker necklace synergy with obsidian melee weapons.
    const ob = obsidianArmourBonus(loadout.equipment);
    maxHit = Math.trunc(maxHit * ob.dmgMult);
    attackRoll = Math.trunc(attackRoll * ob.accMult);
    pushIfFired(effects, 'Obsidian set', ob);
    const bn = berserkerNeckBonus(loadout.equipment);
    maxHit = Math.trunc(maxHit * bn.dmgMult);
    pushIfFired(effects, 'Berserker necklace', bn);

    // Colossal blade: +min(size*2, 10) flat damage to max hit.
    const cbBonus = colossalBladeBonus(weapon, monster);
    maxHit += cbBonus;
    if (cbBonus > 0) effects.push({ name: 'Colossal blade', detail: `+${cbBonus} max hit (size ${monster.size})` });

    // Vampyre weapons (Blisterwood / Ivandis flail) vs T2/T3 vampyres.
    const vb = vampyreWeaponBonus(weapon, monster);
    maxHit = Math.trunc(maxHit * vb.dmgMult);
    attackRoll = Math.trunc(attackRoll * vb.accMult);
    if (weapon) pushIfFired(effects, weapon.name, vb, 'vs vampyre');
  } else if (style === 'ranged') {
    effectiveAttack = Math.floor(sk.ranged * pr.ranged) + stance.ranged + 8;
    effectiveStrength = Math.floor(sk.ranged * pr.rangedStr) + stance.ranged + 8;
    attackRoll = effectiveAttack * (eq.offensive.ranged + 64);
    // Eclipse atlatl quirk: it's the only ranged weapon that scales max hit off
    // the equipment-screen Strength bonus instead of Ranged Strength. The wiki/data
    // record this faithfully (atlatl's +40 sits in `bonuses.str`, ranged_str=0), so
    // we have to swap the input here. Eclipse Moon armor pieces also park their
    // small bonus in `bonuses.str`, so summing across the loadout already picks
    // those up — this is the only line that needs to change.
    const rangedStrBonus = isEclipseAtlatl(weapon) ? eq.bonuses.str : eq.bonuses.ranged_str;
    maxHit = Math.floor(0.5 + (effectiveStrength * (rangedStrBonus + 64)) / 640);
    defenceRoll = (monster.skills.def + 9) * (monster.defensive.standard + 64);
    if (isEclipseAtlatl(weapon)) {
      effects.push({
        name: 'Eclipse atlatl',
        detail: `uses Strength bonus +${eq.bonuses.str} for max hit (in place of Ranged Strength)`,
      });
    }

    // Twisted bow: dmg/acc scales with target's magic level.
    const tb = twistedBowMult(weapon, monster);
    maxHit = Math.trunc(maxHit * tb.dmgMult);
    attackRoll = Math.trunc(attackRoll * tb.accMult);
    pushIfFired(effects, 'Twisted bow', tb, `(target mag ${monster.skills.magic})`);

    // Void Knight / Elite Void — ranger helm set.
    const vr = voidBonus(loadout.equipment, 'ranged');
    maxHit = Math.trunc(maxHit * vr.dmgMult);
    attackRoll = Math.trunc(attackRoll * vr.accMult);
    pushIfFired(effects, 'Void (ranged)', vr);

    // Crystal armour synergy with Crystal bow / Bow of Faerdhinen.
    const cr = crystalArmourBonus(loadout.equipment);
    maxHit = Math.trunc(maxHit * cr.dmgMult);
    attackRoll = Math.trunc(attackRoll * cr.accMult);
    pushIfFired(effects, 'Crystal armour', cr);

    // Dragon hunter crossbow vs dragons.
    const dhr = dragonHunterMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dhr.dmgMult);
    attackRoll = Math.trunc(attackRoll * dhr.accMult);
    if (weapon) pushIfFired(effects, weapon.name, dhr, 'vs dragon');

    // Scorching bow vs demons — ranged demonbane.
    const sb = scorchingBowMult(weapon, monster);
    maxHit = Math.trunc(maxHit * sb.dmgMult);
    attackRoll = Math.trunc(attackRoll * sb.accMult);
    if (weapon) pushIfFired(effects, weapon.name, sb, 'vs demon');
  } else {
    // Magic.
    const magicLevel = sk.magic;

    // Apply Tumeken's-shadow multiplier to gear contributions (×3, capped at +100%).
    let geartMagicStr = eq.bonuses.magic_str;
    let offensiveMagic = eq.offensive.magic;
    if (weapon?.name === "Tumeken's shadow") {
      const f = shadowDamageMultiplier(weapon.name); // 3
      geartMagicStr = Math.min(1000, geartMagicStr * f);
      offensiveMagic = offensiveMagic * f;
      effects.push({ name: "Tumeken's shadow", detail: '×3 magic dmg & acc gear bonuses (out-of-ToA)' });
    }

    effectiveAttack = Math.floor(magicLevel * pr.magic) + stance.magic + 9;
    attackRoll = effectiveAttack * (offensiveMagic + 64);
    defenceRoll = (monster.skills.magic + 9) * (monster.defensive.magic + 64);
    effectiveStrength = magicLevel; // magic has no "effective strength" stat

    // 1) Resolve base max hit + the spell/powered-staff context for bonuses
    let baseMax = 0;
    const spell = spellByName(loadout.spell);
    if (weapon && (isPoweredStaff(weapon) || isSalamander(weapon))) {
      baseMax = poweredStaffMaxHit(weapon.name, magicLevel) ?? 0;
    } else if (allowsSpellCasting(weapon) || weapon === null) {
      if (spell) baseMax = getSpellMaxHit(spell, magicLevel, weapon);
      if (spell?.name === 'Magic Dart' && weapon) {
        const variant = weapon.name === "Slayer's staff (e)" ? '(e) — magic/6 + 13' : 'magic/10 + 10';
        if (baseMax > 0) effects.push({ name: weapon.name, detail: `Magic Dart: ${variant} = ${baseMax}` });
      }
    }

    // 2) Apply magic damage bonus — additive in tenths-of-a-percent.
    //    maxHit = baseMax + trunc(baseMax * magicDmgBonus / 1000)
    // Magic damage bonus is gear-only — no standard prayer contributes.
    // Bonus is in tenths-of-a-percent (so 30 = +3%).
    const magicDmgBonus = geartMagicStr;
    maxHit = baseMax + Math.trunc((baseMax * magicDmgBonus) / 1000);

    // Chaos gauntlets add a flat +3 to max hit on Bolt spells, BEFORE the
    // book/staff multiplier so Tome of fire scales the +3 as well.
    const cgBonus = chaosGauntletsBonus(loadout.equipment.hands, spell);
    maxHit += cgBonus;
    if (cgBonus > 0) effects.push({ name: 'Chaos gauntlets', detail: `+${cgBonus} max hit (Bolt spell)` });

    // 3) Apply weapon/book multiplier (Tome of fire ×1.5, Smoke staff ×1.1, …).
    //    Spell-only — powered staves don't use spells, so bonus is identity.
    const shield = loadout.equipment.shield ?? null;
    const mw = magicWeaponMult(weapon, shield, spell);
    maxHit = Math.trunc(maxHit * mw.dmgMult);
    attackRoll = Math.trunc(attackRoll * mw.accMult);
    if (mw.dmgMult !== 1 || mw.accMult !== 1) {
      const src = (shield && /^Tome of/i.test(shield.name)) ? shield.name : weapon?.name ?? 'Magic weapon';
      pushIfFired(effects, src, mw, spell ? `on ${spell.name}` : '');
    }

    // Monster elemental weakness — when the cast spell's element matches a
    // weakness the monster has in the data (e.g. Kree'arra weak to air at
    // severity 30), both max hit and attack roll get a 1 + severity/100
    // multiplier. Without this, the optimizer never picked Wind/Air spells
    // for fight scenarios where they were obviously correct (Kree'arra,
    // Smoke devil, etc).
    if (
      spell?.element
      && monster.weakness?.element === spell.element
      && monster.weakness.severity
    ) {
      const mult = 1 + monster.weakness.severity / 100;
      maxHit = Math.trunc(maxHit * mult);
      attackRoll = Math.trunc(attackRoll * mult);
      effects.push({
        name: 'Elemental weakness',
        detail: `${spell.element} +${monster.weakness.severity}% dmg & acc on ${monster.name}`,
      });
    }

    // Void Knight / Elite Void — mage helm set.
    const vmg = voidBonus(loadout.equipment, 'magic');
    maxHit = Math.trunc(maxHit * vmg.dmgMult);
    attackRoll = Math.trunc(attackRoll * vmg.accMult);
    pushIfFired(effects, 'Void (magic)', vmg);

    // Virtus robes — per-piece bonus on ancient-spellbook spells.
    const vir = virtusBonus(loadout.equipment, spell);
    maxHit = Math.trunc(maxHit * vir.dmgMult);
    pushIfFired(effects, 'Virtus robes', vir, '(ancient)');

    // Dragon hunter wand vs dragons — +50% acc, +20% dmg.
    const dhw = dragonHunterMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dhw.dmgMult);
    attackRoll = Math.trunc(attackRoll * dhw.accMult);
    if (weapon) pushIfFired(effects, weapon.name, dhw, 'vs dragon');
  }

  // Wilderness weapons — +50% dmg & acc when wielded in the wild.
  const wb = wildernessWeaponBonus(weapon, loadout.inWilderness);
  maxHit = Math.trunc(maxHit * wb.dmgMult);
  attackRoll = Math.trunc(attackRoll * wb.accMult);
  if (weapon) pushIfFired(effects, weapon.name, wb, '(wilderness)');

  // Efaritay's aid — +10% acc vs vampyres (any tier), any style.
  const efar = efaritayAccuracyBonus(loadout.equipment, monster);
  attackRoll = Math.trunc(attackRoll * efar);
  if (efar !== 1) effects.push({ name: "Efaritay's aid", detail: `${pct(efar, true)} acc vs vampyre` });

  // Target-type bonus (Salve amulet, Slayer helm (i), Black mask (i)).
  // Applied to max hit and attack roll across all styles.
  const tb = targetTypeBonus(loadout, monster, style);
  maxHit = Math.trunc(maxHit * tb.dmgMult);
  attackRoll = Math.trunc(attackRoll * tb.accMult);
  if (tb.dmgMult !== 1 || tb.accMult !== 1) {
    const neck = loadout.equipment.neck;
    const head = loadout.equipment.head;
    const src = neck && /^Salve amulet/i.test(neck.name) ? neck.name
      : head && /^(Slayer helmet|Black mask)/i.test(head.name) ? head.name
      : 'Target-type bonus';
    pushIfFired(effects, src, tb);
  }

  // Attack vs defence accuracy
  let accuracy: number;
  if (attackRoll > defenceRoll) {
    accuracy = 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  } else {
    accuracy = attackRoll / (2 * (defenceRoll + 1));
  }
  accuracy = Math.max(0, Math.min(1, accuracy));

  // Osmumten's fang: on a missed accuracy roll, reroll once. Net accuracy is
  // `1 - (1 - p)^2`. (The 15-85% damage range doesn't affect the average, so
  // only the accuracy boost matters outside ToA.)
  if (weapon?.name === "Osmumten's fang" && style === 'melee') {
    const before = accuracy;
    accuracy = 1 - (1 - accuracy) ** 2;
    effects.push({
      name: "Osmumten's fang",
      detail: `accuracy reroll: ${(before * 100).toFixed(1)}% → ${(accuracy * 100).toFixed(1)}%`,
    });
  }

  // Most weapons deal accuracy*max/2 damage per swing. Scythe and friends
  // deviate — delegate to weaponEffects for those, fall back to the default.
  const ammo = loadout.equipment.ammo ?? null;
  const specialAvg = specialAvgPerSwing(weapon, ammo, maxHit, accuracy, monster);
  let avgHit = specialAvg ?? accuracy * (maxHit / 2);

  if (specialAvg !== null) {
    if (isScythe(weapon)) {
      const hits = monster.size >= 3 ? 3 : monster.size >= 2 ? 2 : 1;
      effects.push({ name: weapon!.name, detail: `${hits}-hit swing (size ${monster.size})` });
    } else if (isDualMacuahuitl(weapon)) {
      effects.push({ name: 'Dual macuahuitl', detail: '2-hit swing, shared accuracy roll' });
    } else {
      const proc = boltProcName(weapon, ammo);
      if (proc) effects.push({ name: proc, detail: 'enchanted bolt expected dmg per swing' });
    }
  }

  // Eclipse Moon set + Eclipse atlatl: 20% chance per landed hit to apply a
  // burn (10 dmg over 40t, 5-stack cap). At atlatl swing speeds (4t / 3t
  // rapid) steady-state stacks ≈ 2–2.67, well under the cap, so the cap
  // never binds. Added as flat avg-damage-per-swing alongside the hit.
  if (style === 'ranged' && isEclipseAtlatl(weapon)) {
    const burnAvg = eclipseMoonBurnAvgPerSwing(weapon, accuracy, loadout.equipment);
    if (burnAvg > 0) {
      avgHit += burnAvg;
      effects.push({
        name: 'Eclipse Moon set',
        detail: `+${burnAvg.toFixed(2)} avg burn dmg/swing (20% × 10 dmg × acc ${(accuracy * 100).toFixed(1)}%)`,
      });
    }
  }

  // Keris 1/51 triple-damage proc vs kalphite/scarab — applied to avg only.
  if (style === 'melee') {
    const kbAvg = kerisBonus(weapon, monster).avgDmgMult;
    if (kbAvg !== 1) {
      avgHit = avgHit * kbAvg;
      effects.push({ name: 'Keris 1/51 proc', detail: `triple-dmg expected ×${kbAvg.toFixed(3)}` });
    }
  }

  // Keris partisan of the sun: +25% acc vs <25% HP targets, ToA-only. We
  // model the kill-averaged effect as a multiplier on avgHit (75% of HP at
  // base accuracy, 25% at boosted/clamped accuracy).
  if (style === 'melee') {
    const sunMult = kerisSunAccBoostMult(weapon, loadout.raidScaling, accuracy);
    if (sunMult !== 1) {
      avgHit = avgHit * sunMult;
      const boosted = Math.min(1, accuracy * 1.25);
      effects.push({
        name: 'Keris partisan of the sun',
        detail: `ToA execute phase: acc ${(accuracy * 100).toFixed(1)}% → ${(boosted * 100).toFixed(1)}% on bottom 25% HP, ×${sunMult.toFixed(3)} kill-avg`,
      });
    }
  }

  // Weapon speed, with Harmonised nightmare staff standard-spellbook override.
  const baseSpeed = stanceWeaponSpeed(eq.weaponSpeed, style, selectedStance, weapon);
  const spellForSpeed = style === 'magic' ? spellByName(loadout.spell) : null;
  const weaponSpeedTicks = harmonisedSpeedOverride(weapon, spellForSpeed, baseSpeed);
  if (weaponSpeedTicks < baseSpeed) {
    effects.push({
      name: 'Harmonised nightmare staff',
      detail: `${baseSpeed}t → ${weaponSpeedTicks}t (standard spellbook)`,
    });
  }
  // Blood Moon set + Macuahuitl: 33%/hit chance to attack 1 tick early. With 2
  // hits per swing → 5/9 swing-level proc, conditional on the swing landing.
  // Avg ticks-saved per swing = accuracy * 5/9. Doesn't change displayed
  // weaponSpeedTicks (kept as base) — only the effective time-per-swing.
  let effectiveTicks = weaponSpeedTicks;
  if (style === 'melee') {
    const bm = bloodMoonSpeedReduction(weapon, accuracy, loadout.equipment);
    if (bm > 0) {
      effectiveTicks = Math.max(1, weaponSpeedTicks - bm);
      effects.push({
        name: 'Blood Moon set',
        detail: `avg ${effectiveTicks.toFixed(2)}t / swing (proc 5/9 × acc ${(accuracy * 100).toFixed(1)}%)`,
      });
    }
  }
  const weaponSpeedSec = effectiveTicks * SECONDS_PER_TICK;
  const dps = weaponSpeedSec > 0 ? avgHit / weaponSpeedSec : 0;

  const hp = monster.skills.hp || 1;
  const ttkSeconds = dps > 0 ? hp / dps : Infinity;

  return {
    maxHit,
    accuracy,
    dps,
    avgHit,
    weaponSpeedTicks,
    ttkSeconds,
    details: { effectiveAttack, effectiveStrength, attackRoll, defenceRoll },
    effects,
  };
}

// Convenience: produce a cheap "score" used for pruning equipment.
export function pieceScore(p: EquipmentPiece, style: CombatStyle, attackStyle?: string): number {
  if (style === 'melee') {
    const offStyle = attackStyle === 'stab' ? p.offensive.stab
      : attackStyle === 'slash' ? p.offensive.slash
      : p.offensive.crush;
    return offStyle * 0.5 + p.bonuses.str * 6;
  }
  if (style === 'ranged') {
    // Eclipse atlatl + Eclipse Moon armor are the only ranged setup that scales max hit
    // off the equipment-screen Strength bonus instead of Ranged Strength — they record
    // their contribution in `bonuses.str` (rstr=0). For shortlisting purposes only,
    // count str as ranged_str for these specific pieces so they survive top-N pruning.
    // (Doing this for *all* ranged-eligible pieces would inflate every melee glove and
    // amulet — many real ranged-compatible pieces carry incidental melee str.)
    const isAtlatlFamily = p.name === 'Eclipse atlatl' || /^Eclipse moon/.test(p.name);
    const effRangedStr = isAtlatlFamily ? p.bonuses.ranged_str + p.bonuses.str : p.bonuses.ranged_str;
    return p.offensive.ranged * 0.5 + effRangedStr * 6;
  }
  return p.offensive.magic * 0.5 + p.bonuses.magic_str * 6;
}
