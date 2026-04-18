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
import {
  berserkerNeckBonus,
  colossalBladeBonus,
  crystalArmourBonus,
  demonbaneMult,
  dragonHunterMult,
  efaritayAccuracyBonus,
  harmonisedSpeedOverride,
  inquisitorBonus,
  kerisBonus,
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
  /** Additive magic damage bonus in tenths-of-a-percent (Augury = 40 → +4%). */
  magicDmgAdd: number;
  def: number;
}

function prayerMultipliers(pr: Prayers): PrayerMults {
  const m: PrayerMults = { atk: 1, str: 1, ranged: 1, rangedStr: 1, magic: 1, magicDmgAdd: 0, def: 1 };

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

  // Magic — accuracy multiplicative, damage additive in /1000.
  if (pr.mysticWill) { m.magic = Math.max(m.magic, 1.05); }
  if (pr.mysticLore) { m.magic = Math.max(m.magic, 1.10); m.magicDmgAdd = Math.max(m.magicDmgAdd, 10); }
  if (pr.mysticMight) { m.magic = Math.max(m.magic, 1.15); m.magicDmgAdd = Math.max(m.magicDmgAdd, 20); }
  if (pr.augury) { m.magic = Math.max(m.magic, 1.25); m.magicDmgAdd = Math.max(m.magicDmgAdd, 40); m.def = Math.max(m.def, 1.25); }

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

export function calcDps(loadout: PlayerLoadout, monster: Monster): CalcResult {
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

    // Demonbane weapons (Arclight / Emberlight / Darklight) vs demons.
    const dm = demonbaneMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dm.dmgMult);
    attackRoll = Math.trunc(attackRoll * dm.accMult);

    // Inquisitor's armour — +0.5% per piece, +2.5% full set, crush only.
    const iq = inquisitorBonus(loadout.equipment, loadout.attackStyle);
    maxHit = Math.trunc(maxHit * iq.dmgMult);
    attackRoll = Math.trunc(attackRoll * iq.accMult);

    // Void Knight / Elite Void — melee helm set.
    const vm = voidBonus(loadout.equipment, 'melee');
    maxHit = Math.trunc(maxHit * vm.dmgMult);
    attackRoll = Math.trunc(attackRoll * vm.accMult);

    // Keris / Keris partisan vs kalphite/scarab — +33% dmg (partisans) & acc
    // (corruption). 1/51 triple-damage proc applied to avg later.
    const kb = kerisBonus(weapon, monster);
    maxHit = Math.trunc(maxHit * kb.dmgMult);
    attackRoll = Math.trunc(attackRoll * kb.accMult);

    // Dragon hunter lance vs dragons.
    const dh = dragonHunterMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dh.dmgMult);
    attackRoll = Math.trunc(attackRoll * dh.accMult);

    // Obsidian armour set + Berserker necklace synergy with obsidian melee weapons.
    const ob = obsidianArmourBonus(loadout.equipment);
    maxHit = Math.trunc(maxHit * ob.dmgMult);
    attackRoll = Math.trunc(attackRoll * ob.accMult);
    const bn = berserkerNeckBonus(loadout.equipment);
    maxHit = Math.trunc(maxHit * bn.dmgMult);

    // Colossal blade: +min(size*2, 10) flat damage to max hit.
    maxHit += colossalBladeBonus(weapon, monster);

    // Vampyre weapons (Blisterwood / Ivandis flail) vs T2/T3 vampyres.
    const vb = vampyreWeaponBonus(weapon, monster);
    maxHit = Math.trunc(maxHit * vb.dmgMult);
    attackRoll = Math.trunc(attackRoll * vb.accMult);
  } else if (style === 'ranged') {
    effectiveAttack = Math.floor(sk.ranged * pr.ranged) + stance.ranged + 8;
    effectiveStrength = Math.floor(sk.ranged * pr.rangedStr) + stance.ranged + 8;
    attackRoll = effectiveAttack * (eq.offensive.ranged + 64);
    maxHit = Math.floor(0.5 + (effectiveStrength * (eq.bonuses.ranged_str + 64)) / 640);
    defenceRoll = (monster.skills.def + 9) * (monster.defensive.standard + 64);

    // Twisted bow: dmg/acc scales with target's magic level.
    const tb = twistedBowMult(weapon, monster);
    maxHit = Math.trunc(maxHit * tb.dmgMult);
    attackRoll = Math.trunc(attackRoll * tb.accMult);

    // Void Knight / Elite Void — ranger helm set.
    const vr = voidBonus(loadout.equipment, 'ranged');
    maxHit = Math.trunc(maxHit * vr.dmgMult);
    attackRoll = Math.trunc(attackRoll * vr.accMult);

    // Crystal armour synergy with Crystal bow / Bow of Faerdhinen.
    const cr = crystalArmourBonus(loadout.equipment);
    maxHit = Math.trunc(maxHit * cr.dmgMult);
    attackRoll = Math.trunc(attackRoll * cr.accMult);

    // Dragon hunter crossbow vs dragons.
    const dhr = dragonHunterMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dhr.dmgMult);
    attackRoll = Math.trunc(attackRoll * dhr.accMult);

    // Scorching bow vs demons — ranged demonbane.
    const sb = scorchingBowMult(weapon, monster);
    maxHit = Math.trunc(maxHit * sb.dmgMult);
    attackRoll = Math.trunc(attackRoll * sb.accMult);
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
      if (spell) baseMax = getSpellMaxHit(spell, magicLevel);
    }

    // 2) Apply magic damage bonus — additive in tenths-of-a-percent.
    //    maxHit = baseMax + trunc(baseMax * magicDmgBonus / 1000)
    const magicDmgBonus = geartMagicStr + pr.magicDmgAdd;
    maxHit = baseMax + Math.trunc((baseMax * magicDmgBonus) / 1000);

    // 3) Apply weapon/book multiplier (Tome of fire ×1.5, Smoke staff ×1.1, …).
    //    Spell-only — powered staves don't use spells, so bonus is identity.
    const shield = loadout.equipment.shield ?? null;
    const mw = magicWeaponMult(weapon, shield, spell);
    maxHit = Math.trunc(maxHit * mw.dmgMult);
    attackRoll = Math.trunc(attackRoll * mw.accMult);

    // Void Knight / Elite Void — mage helm set.
    const vmg = voidBonus(loadout.equipment, 'magic');
    maxHit = Math.trunc(maxHit * vmg.dmgMult);
    attackRoll = Math.trunc(attackRoll * vmg.accMult);

    // Virtus robes — per-piece bonus on ancient-spellbook spells.
    const vir = virtusBonus(loadout.equipment, spell);
    maxHit = Math.trunc(maxHit * vir.dmgMult);

    // Dragon hunter wand vs dragons — +50% acc, +20% dmg.
    const dhw = dragonHunterMult(weapon, monster);
    maxHit = Math.trunc(maxHit * dhw.dmgMult);
    attackRoll = Math.trunc(attackRoll * dhw.accMult);
  }

  // Wilderness weapons — +50% dmg & acc when wielded in the wild.
  const wb = wildernessWeaponBonus(weapon, loadout.inWilderness);
  maxHit = Math.trunc(maxHit * wb.dmgMult);
  attackRoll = Math.trunc(attackRoll * wb.accMult);

  // Efaritay's aid — +10% acc vs vampyres (any tier), any style.
  attackRoll = Math.trunc(attackRoll * efaritayAccuracyBonus(loadout.equipment, monster));

  // Target-type bonus (Salve amulet, Slayer helm (i), Black mask (i)).
  // Applied to max hit and attack roll across all styles.
  const tb = targetTypeBonus(loadout, monster, style);
  maxHit = Math.trunc(maxHit * tb.dmgMult);
  attackRoll = Math.trunc(attackRoll * tb.accMult);

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
    accuracy = 1 - (1 - accuracy) ** 2;
  }

  // Most weapons deal accuracy*max/2 damage per swing. Scythe and friends
  // deviate — delegate to weaponEffects for those, fall back to the default.
  const ammo = loadout.equipment.ammo ?? null;
  const specialAvg = specialAvgPerSwing(weapon, ammo, maxHit, accuracy, monster);
  let avgHit = specialAvg ?? accuracy * (maxHit / 2);

  // Keris 1/51 triple-damage proc vs kalphite/scarab — applied to avg only.
  if (style === 'melee') {
    const kbAvg = kerisBonus(weapon, monster).avgDmgMult;
    if (kbAvg !== 1) avgHit = avgHit * kbAvg;
  }

  // Weapon speed, with Harmonised nightmare staff standard-spellbook override.
  const baseSpeed = stanceWeaponSpeed(eq.weaponSpeed, style, selectedStance, weapon);
  const spellForSpeed = style === 'magic' ? spellByName(loadout.spell) : null;
  const weaponSpeedTicks = harmonisedSpeedOverride(weapon, spellForSpeed, baseSpeed);
  const weaponSpeedSec = weaponSpeedTicks * SECONDS_PER_TICK;
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
    return p.offensive.ranged * 0.5 + p.bonuses.ranged_str * 6;
  }
  return p.offensive.magic * 0.5 + p.bonuses.magic_str * 6;
}
