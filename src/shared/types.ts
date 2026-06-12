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

/** Which raid (if any) the target is being fought in. Drives HP / def-level scaling. */
export type RaidKind = 'toa' | 'cox' | 'tob';

/**
 * Raid scaling context. Optional — when omitted, the monster's stats are used
 * as-shipped (already correct for non-raid bosses, and for ToB the per-mode
 * variant in the monster data is the 5-man baseline that we scale down from).
 */
export interface RaidScaling {
  kind: RaidKind;
  /** ToA: 1-8. CoX: 1-15+ typical. ToB: 1-5. */
  partySize: number;
  /** ToA only: 0..700+. Drives HP, atk, def scaling of the monster. */
  raidLevel?: number;
  /** ToA path bosses only: 0..6. Adds bonus HP on top of raid-level scaling. */
  pathLevel?: number;
  /** CoX challenge mode — bumps HP by 50%. */
  challengeMode?: boolean;
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
  /** Raid context — scales target HP/def before the DPS roll. */
  raidScaling?: RaidScaling;
  /** Pre-applied defence drain (DWH/BGS/etc. spec hits) to simulate the real
   *  fight after an opener. Applied to the target after raid scaling. */
  defenceReduction?: DefenceReduction;
}

/**
 * Defence-draining opener applied to the target before the DPS roll, so the
 * simulated DPS reflects the real fight after a few spec hits. Counts are
 * successful hits; `bgs` is total Defence levels drained by Bandos godsword
 * spec damage. Mechanics mirror the OSRS Wiki calculator.
 */
export interface DefenceReduction {
  /** Dragon warhammer hits — each removes 30% of current Defence. */
  dwh: number;
  /** Elder maul hits — each removes 35% of current Defence. */
  elderMaul: number;
  /** Arclight hits — flat per-hit drain off base Defence (2× vs demons). */
  arclight: number;
  /** Emberlight hits — flat per-hit drain off base Defence (3× vs demons). */
  emberlight: number;
  /** Bandos godsword: total Defence levels drained (= spec damage dealt). */
  bgs: number;
  /** Accursed sceptre: −15% Defence and Magic level. */
  accursed: boolean;
  /** Vulnerability spell: −10% Defence level. */
  vulnerability: boolean;
}

/**
 * One conditional effect that fired during the DPS calculation. Used by the
 * UI to explain *why* a particular gear pick scored where it did.
 */
export interface FiredEffect {
  /** Short label — typically the gear/effect name. */
  name: string;
  /** Human-readable explanation: what fired, what the bonus was. */
  detail: string;
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
  /** Conditional effects that actually fired (Salve, TBow scaling, multi-hit, raid scaling, etc.). */
  effects: FiredEffect[];
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
  /** Total GE cost of the setup (owned items = 0). Only set in budget mode. */
  totalCost?: number;
}
