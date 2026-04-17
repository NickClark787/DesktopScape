/**
 * Shared domain types. Wire-format compatible with weirdgloop/osrs-dps-calc JSON.
 */

export type EquipmentSlot =
  | 'head'
  | 'cape'
  | 'neck'
  | 'ammo'
  | 'weapon'
  | 'body'
  | 'shield'
  | 'legs'
  | 'hands'
  | 'feet'
  | 'ring'
  | '2h';

export const EQUIPMENT_SLOTS: Exclude<EquipmentSlot, '2h'>[] = [
  'head', 'cape', 'neck', 'ammo', 'weapon', 'body',
  'shield', 'legs', 'hands', 'feet', 'ring',
];

export interface EquipmentBonuses {
  str: number;
  ranged_str: number;
  magic_str: number;
  prayer: number;
}

export interface StyleStats {
  stab: number;
  slash: number;
  crush: number;
  magic: number;
  ranged: number;
}

export interface EquipmentPiece {
  id: number;
  name: string;
  version: string;
  slot: EquipmentSlot;
  image: string;
  weight: number;
  speed: number;
  category: string;
  bonuses: EquipmentBonuses;
  offensive: StyleStats;
  defensive: StyleStats;
  isTwoHanded: boolean;
}

export type MonsterCombatStyle = 'Stab' | 'Slash' | 'Crush' | 'Ranged' | 'Magic' | string;

export interface MonsterDefensive {
  flat_armour: number;
  stab: number;
  slash: number;
  crush: number;
  magic: number;
  heavy: number;
  standard: number;
  light: number;
}

export interface MonsterOffensive {
  atk: number;
  str: number;
  magic: number;
  magic_str: number;
  ranged: number;
  ranged_str: number;
}

export interface MonsterSkills {
  atk: number;
  def: number;
  hp: number;
  magic: number;
  ranged: number;
  str: number;
}

export interface Monster {
  id: number;
  name: string;
  version: string;
  image: string;
  level: number;
  speed: number;
  style: MonsterCombatStyle[];
  size: number;
  max_hit: string;
  skills: MonsterSkills;
  offensive: MonsterOffensive;
  defensive: MonsterDefensive;
  attributes: string[];
  immunities: Record<string, unknown> | null;
  is_slayer_monster: boolean;
  weakness: { element?: string; severity?: number } | null;
}

export interface PlayerSkills {
  atk: number;
  str: number;
  def: number;
  hp: number;
  magic: number;
  ranged: number;
  prayer: number;
}

export type CombatStyle = 'melee' | 'ranged' | 'magic';

export type MeleeAttackType = 'stab' | 'slash' | 'crush';
export type AttackType = MeleeAttackType | 'ranged' | 'magic';

/** Weapon attack stance. Drives hidden atk/str/def bonuses and, for ranged, weapon speed. */
export type WeaponStance =
  | 'accurate'
  | 'aggressive'
  | 'controlled'
  | 'defensive'
  | 'rapid'
  | 'longrange';

export interface Prayers {
  // Melee
  piety: boolean;
  chivalry: boolean;
  ultimateStrength: boolean;
  superhumanStrength: boolean;
  burstOfStrength: boolean;
  incredibleReflexes: boolean;
  improvedReflexes: boolean;
  clarityOfThought: boolean;
  // Ranged
  rigour: boolean;
  eagleEye: boolean;
  hawkEye: boolean;
  sharpEye: boolean;
  // Magic
  augury: boolean;
  mysticMight: boolean;
  mysticLore: boolean;
  mysticWill: boolean;
}

export interface Potions {
  melee:
    | 'none'
    | 'attack'
    | 'strength'
    | 'combat'
    | 'super_attack'
    | 'super_strength'
    | 'super_combat'
    | 'overload';
  ranged: 'none' | 'ranging' | 'super_ranging' | 'divine_ranging' | 'overload';
  magic: 'none' | 'magic' | 'imbued_heart' | 'saturated_heart' | 'ancient_brew' | 'forgotten_brew' | 'overload';
}

export interface PlayerLoadout {
  style: CombatStyle;
  attackStyle: AttackType;
  skills: PlayerSkills;
  prayers: Prayers;
  potions: Potions;
  onSlayerTask: boolean;
  inWilderness: boolean;
  equipment: Partial<Record<Exclude<EquipmentSlot, '2h'>, EquipmentPiece | null>>;
  /** Selected combat spell name (magic only). Ignored when a powered staff is equipped. */
  spell: string | null;
  /** Weapon stance. Defaults to 'accurate' when omitted. */
  stance?: WeaponStance;
}

export interface CalcResult {
  maxHit: number;
  accuracy: number; // 0..1
  dps: number;
  avgHit: number;
  weaponSpeedTicks: number;
  ttkSeconds: number;
  details: {
    effectiveAttack: number;
    effectiveStrength: number;
    attackRoll: number;
    defenceRoll: number;
  };
}

export interface BestSetupCandidate {
  equipment: PlayerLoadout['equipment'];
  result: CalcResult;
  style: CombatStyle;
  attackStyle: AttackType;
  /** Spell used by the candidate (magic only). Null means a powered staff drove the max hit. */
  spell?: string | null;
  /** Stance picked by the optimizer. */
  stance?: WeaponStance;
}
