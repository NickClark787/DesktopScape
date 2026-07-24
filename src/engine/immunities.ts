/**
 * Style / weapon immunity gates. A handful of monsters take zero damage from
 * entire combat styles (Zulrah vs melee, Tekton vs ranged, …) or from any
 * weapon outside a special class (leafy → leaf-bladed, CoX Guardians →
 * pickaxes, aviansies → salamanders in melee). The optimizer relies on these
 * gates to stop recommending gear the game would bounce off for 0s.
 *
 * IDs and rules ported from the wiki calculator's isImmune
 * (PlayerVsNPCCalc:2093-2154) and its constants.ts ID lists. Known gaps that
 * need per-fight inputs we don't model: Doom of Mokhaiotl shield phase and
 * Tormented Demon shield (both phase-dependent).
 */

import type { CombatStyle, EquipmentPiece, Monster } from '@shared/types';
import type { Spell } from './spells';

const DUSK_IDS = [
  7851, 7854, 7855, 7882, 7883, 7886, // first form
  7887, 7888, 7889, // second form
];
const WARRIORS_GUILD_CYCLOPES = [
  2463, 2465, 2467, // L56
  2464, 2466, 2468, // L76
  2137, 2138, 2139, 2140, 2141, 2142, // L106
];
const TEKTON_IDS = [7540, 7543, 7544, 7545];
const GLOWING_CRYSTAL_IDS = [7568];
const ABYSSAL_PORTAL_IDS = [7533];
const ZULRAH_IDS = [2042, 2043, 2044];
const VESPULA_IDS = [7530, 7531, 7532];
const GUARDIAN_IDS = [7569, 7571, 7570, 7572];
/** Aviansies can only be meleed with a salamander — not even halberds work. */
const AVIANSIE_SALAMANDER_ONLY_IDS = [
  3169, 3170, 3171, 3172, 3173, 3174, 3175, 3176, 3177, 3178, 3179, 3180, 3181, 3182, 3183,
  7037, // reanimated aviansie
];
const ECLIPSE_MOON_ID = 13012;

const IMMUNE_TO_MELEE = new Set([
  494, // Kraken
  ...ABYSSAL_PORTAL_IDS,
  7706, // TzKal-Zuk
  7708, // Jal-MejJak
  12214, 12215, 12219, // Leviathan
  ...ZULRAH_IDS,
]);
const IMMUNE_TO_RANGED = new Set([
  ...TEKTON_IDS, ...DUSK_IDS, ...GLOWING_CRYSTAL_IDS, ...WARRIORS_GUILD_CYCLOPES,
]);
const IMMUNE_TO_MAGIC = new Set([...DUSK_IDS, ...WARRIORS_GUILD_CYCLOPES]);

const LEAF_BLADED_MELEE = new Set([
  'Leaf-bladed battleaxe',
  'Leaf-bladed spear',
  'Leaf-bladed sword',
]);
const BROAD_AMMO = new Set(['Broad arrows', 'Broad bolts', 'Amethyst broad bolts']);

/** Bone weapons only work on rat-attribute monsters (and get +10 max hit there). */
export const RAT_BONE_WEAPONS = new Set(['Bone mace', 'Bone shortbow', 'Bone staff']);

function hasAttr(monster: Monster, attr: string): boolean {
  return (monster.attributes || []).some((a) => a.toLowerCase() === attr);
}

/**
 * Can this loadout damage leafy-attribute monsters (Turoth / Kurask)?
 * Melee: leaf-bladed weapons. Ranged: broad ammo. Magic: Magic Dart.
 * Mirrors BaseCalc.isWearingLeafBladedWeapon.
 */
function canHarmLeafy(
  style: CombatStyle,
  weapon: EquipmentPiece | null,
  ammo: EquipmentPiece | null,
  spell: Spell | null,
): boolean {
  if (style === 'melee' && weapon && LEAF_BLADED_MELEE.has(weapon.name)) return true;
  if (spell?.name === 'Magic Dart') return true;
  if (style === 'ranged' && ammo && BROAD_AMMO.has(ammo.name)) return true;
  return false;
}

export interface ImmunityContext {
  style: CombatStyle;
  weapon: EquipmentPiece | null;
  ammo: EquipmentPiece | null;
  /** The spell actually being cast (null for non-magic styles / powered staves). */
  spell: Spell | null;
}

/**
 * Returns a human-readable reason when the monster takes zero damage from
 * this loadout, or null when the attack works. calcDps zeroes the hit on a
 * non-null verdict; the reason feeds the effects-fired panel so users see
 * *why* the DPS is 0.
 */
export function styleImmunityReason(monster: Monster, ctx: ImmunityContext): string | null {
  const { style, weapon, ammo, spell } = ctx;
  const category = weapon?.category ?? '';
  const isMelee = style === 'melee';

  if (style === 'magic' && IMMUNE_TO_MAGIC.has(monster.id)) {
    return `${monster.name} is immune to magic damage`;
  }
  if (style === 'ranged' && IMMUNE_TO_RANGED.has(monster.id)) {
    return `${monster.name} is immune to ranged damage`;
  }
  if (isMelee && IMMUNE_TO_MELEE.has(monster.id)) {
    // Zulrah can be poked with a halberd from across the pool.
    if (ZULRAH_IDS.includes(monster.id) && category === 'Polearm') return null;
    return `${monster.name} is immune to melee damage`;
  }
  if (isMelee && hasAttr(monster, 'flying')) {
    // Vespula is immune to melee despite the polearm/salamander reach rule.
    if (VESPULA_IDS.includes(monster.id)) {
      return `${monster.name} is immune to melee damage`;
    }
    if (category !== 'Polearm' && category !== 'Salamander') {
      return `${monster.name} is flying — melee needs a halberd or salamander`;
    }
  }
  if (isMelee && AVIANSIE_SALAMANDER_ONLY_IDS.includes(monster.id) && category !== 'Salamander') {
    return `${monster.name} can only be meleed with a salamander`;
  }
  if (GUARDIAN_IDS.includes(monster.id) && (!isMelee || category !== 'Pickaxe')) {
    return `${monster.name} can only be damaged by pickaxes`;
  }
  if (hasAttr(monster, 'leafy') && !canHarmLeafy(style, weapon, ammo, spell)) {
    return `${monster.name} needs a leaf-bladed weapon, broad ammo, or Magic Dart`;
  }
  if (weapon && RAT_BONE_WEAPONS.has(weapon.name) && !hasAttr(monster, 'rat')) {
    return `${weapon.name} only damages rats`;
  }
  if (monster.name === 'Fire Warrior of Lesarkus'
    && (style !== 'ranged' || ammo?.name !== 'Ice arrows')) {
    return `${monster.name} can only be damaged by ice arrows`;
  }
  if (monster.name === 'Fareed') {
    if (style === 'magic' && spell?.element !== 'water') {
      return `${monster.name} is only vulnerable to water spells`;
    }
    if (style === 'ranged' && !(ammo?.name ?? '').toLowerCase().includes('arrow')) {
      return `${monster.name} is only vulnerable to arrows (and water spells)`;
    }
  }
  if (monster.id === ECLIPSE_MOON_ID && monster.version === 'Clone' && !isMelee) {
    return `${monster.name} (Clone) is immune to non-melee attacks`;
  }
  return null;
}
