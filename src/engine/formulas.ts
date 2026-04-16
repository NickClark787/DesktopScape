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
} from '@shared/types';

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
  magicStr: number;
  def: number;
}

function prayerMultipliers(pr: Prayers): PrayerMults {
  const m: PrayerMults = { atk: 1, str: 1, ranged: 1, rangedStr: 1, magic: 1, magicStr: 1, def: 1 };

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

  // Magic
  if (pr.mysticWill) { m.magic = Math.max(m.magic, 1.05); }
  if (pr.mysticLore) { m.magic = Math.max(m.magic, 1.10); m.magicStr = Math.max(m.magicStr, 1.025); }
  if (pr.mysticMight) { m.magic = Math.max(m.magic, 1.15); m.magicStr = Math.max(m.magicStr, 1.05); }
  if (pr.augury) { m.magic = Math.max(m.magic, 1.25); m.magicStr = Math.max(m.magicStr, 1.04); m.def = Math.max(m.def, 1.25); }

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

function stanceBonus(style: CombatStyle, attackStyleId: string): StanceBonus {
  // OSRS: the weapon's chosen attack stance adds hidden levels.
  // "accurate" → +3 to atk (or ranged/magic), "aggressive" → +3 str, "controlled" → +1 to all, "defensive" → +3 def.
  const bonus: StanceBonus = { atk: 0, str: 0, def: 0, ranged: 0, magic: 0 };
  if (style === 'melee') {
    if (attackStyleId === 'accurate') bonus.atk = 3;
    else if (attackStyleId === 'aggressive') bonus.str = 3;
    else if (attackStyleId === 'controlled') { bonus.atk = 1; bonus.str = 1; bonus.def = 1; }
    else if (attackStyleId === 'defensive') bonus.def = 3;
  } else if (style === 'ranged') {
    if (attackStyleId === 'accurate' || attackStyleId === 'rapid') bonus.ranged = 3;
    else if (attackStyleId === 'longrange') bonus.def = 3;
  } else if (style === 'magic') {
    bonus.magic = 3;
  }
  return bonus;
}

// ---------- Core DPS calc ----------

export function calcDps(loadout: PlayerLoadout, monster: Monster): CalcResult {
  const eq = sumEquipment(loadout.equipment);
  const pr = prayerMultipliers(loadout.prayers);
  const sk: PlayerSkills = { ...loadout.skills };
  const { style } = loadout;

  // Apply potion boosts to a copy
  if (style === 'melee') {
    sk.atk += potionAttack(loadout.potions.melee, sk.atk);
    sk.str += potionStrength(loadout.potions.melee, sk.str);
  } else if (style === 'ranged') {
    sk.ranged += potionRanged(loadout.potions.ranged, sk.ranged);
  } else {
    sk.magic += potionMagic(loadout.potions.magic, sk.magic);
  }

  const stance = stanceBonus(style, 'accurate');

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
  } else if (style === 'ranged') {
    effectiveAttack = Math.floor(sk.ranged * pr.ranged) + stance.ranged + 8;
    effectiveStrength = Math.floor(sk.ranged * pr.rangedStr) + stance.ranged + 8;
    attackRoll = effectiveAttack * (eq.offensive.ranged + 64);
    maxHit = Math.floor(0.5 + (effectiveStrength * (eq.bonuses.ranged_str + 64)) / 640);
    defenceRoll = (monster.skills.def + 9) * (monster.defensive.standard + 64);
  } else {
    // Magic — simplified: uses magic level as effective for both roll and damage.
    effectiveAttack = Math.floor(sk.magic * pr.magic) + stance.magic + 8;
    effectiveStrength = Math.floor(sk.magic * pr.magicStr);
    attackRoll = effectiveAttack * (eq.offensive.magic + 64);
    // Base max hit without a spell set: approximate using magic strength bonus alone.
    const baseSpellMax = 30; // placeholder — real calc needs spell selection (TODO: wire Spell data)
    const magicDmgMult = 1 + (eq.bonuses.magic_str / 100) * pr.magicStr;
    maxHit = Math.floor(baseSpellMax * magicDmgMult);
    defenceRoll = (monster.skills.magic + 9) * (monster.defensive.magic + 64);
  }

  // Attack vs defence accuracy
  let accuracy: number;
  if (attackRoll > defenceRoll) {
    accuracy = 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  } else {
    accuracy = attackRoll / (2 * (defenceRoll + 1));
  }
  accuracy = Math.max(0, Math.min(1, accuracy));

  const avgHit = accuracy * (maxHit / 2);
  const weaponSpeedTicks = eq.weaponSpeed;
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
