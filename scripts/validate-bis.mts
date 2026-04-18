/**
 * Reference-loadout validation harness.
 *
 * Pins specific gear + spell + monster + prayers/potions and calls calcDps
 * directly. The goal is to compare our engine's numbers against known-good
 * references from gearscape.net and the weirdgloop DPS calc:
 *   https://dps.osrs.wiki/
 *   https://gearscape.net/calculators/best
 *
 * Expected ranges in the "expect" string are from community calcs; small
 * deltas (~1 max hit, ~1-2% accuracy, ~0.1-0.3 DPS) are normal for edge-case
 * formulas. Big drift means a real bug.
 */

import { readFile } from 'node:fs/promises';
import { calcDps, stancesForStyle } from '../src/engine/formulas.ts';
import type { Monster, EquipmentPiece, PlayerLoadout, Prayers, Potions, WeaponStance } from '../src/shared/types.ts';

const equipment: EquipmentPiece[] = JSON.parse(await readFile('resources/data/equipment.json', 'utf8'));
const monsters: Monster[] = JSON.parse(await readFile('resources/data/monsters.json', 'utf8'));

function findPiece(name: string, version?: string): EquipmentPiece {
  const match = equipment.find(
    (p) => p.name === name && (version === undefined || p.version === version),
  );
  if (!match) throw new Error(`Missing equipment: ${name}${version ? ` (${version})` : ''}`);
  return match;
}

function findMonster(name: string, versionIncludes?: string): Monster {
  const match = versionIncludes
    ? monsters.find((m) => m.name === name && (m.version || '').includes(versionIncludes))
    : monsters.find((m) => m.name === name);
  if (!match) throw new Error(`Missing monster: ${name}${versionIncludes ? ` (${versionIncludes})` : ''}`);
  return match;
}

const noPrayers: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};
const noPotions: Potions = { melee: 'none', ranged: 'none', magic: 'none' };
const maxedSkills = { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 };

interface Case {
  label: string;
  expect: string;
  loadout: PlayerLoadout;
  monster: Monster;
}

function maxedRangedLoadout(weapon: string, ammo: string): PlayerLoadout {
  return {
    style: 'ranged',
    attackStyle: 'ranged',
    skills: { ...maxedSkills },
    prayers: { ...noPrayers, rigour: true },
    potions: { ...noPotions, ranged: 'divine_ranging' },
    onSlayerTask: false,
    inWilderness: false,
    spell: null,
    equipment: {
      head: findPiece('Masori mask (f)'),
      cape: findPiece("Dizana's quiver", 'Charged'),
      neck: findPiece('Necklace of anguish'),
      ammo: findPiece(ammo),
      weapon: findPiece(weapon),
      body: findPiece('Masori body (f)'),
      legs: findPiece('Masori chaps (f)'),
      hands: findPiece('Zaryte vambraces'),
      feet: findPiece('Pegasian boots'),
      ring: findPiece('Venator ring'),
    },
  };
}

const cases: Case[] = [
  {
    label: 'Max melee (Torva + Scythe, Piety + Super combat) vs Vorkath (Post-quest)',
    expect: 'Max hit ~50-56 (first hit), DPS ~7-8 with Torture (Salve ei would push to ~10-12)',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'melee',
      attackStyle: 'slash',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece('Scythe of vitur', 'Charged'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Scythe + Salve(ei) (Torva, Piety + Super combat) vs Vorkath (undead)',
    expect: 'Salve(ei) adds +20% dmg & acc vs undead — max hit ~60, DPS ~10-12',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'melee',
      attackStyle: 'slash',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Salve amulet(ei)'),
        weapon: findPiece('Scythe of vitur', 'Charged'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Max ranged (Masori + Bow of faerdhinen, Rigour + Divine ranging) vs Vorkath',
    expect: 'Max hit ~54-58, accuracy ~80%+, DPS ~10-12',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'ranged',
      attackStyle: 'ranged',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, rigour: true },
      potions: { ...noPotions, ranged: 'divine_ranging' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Masori mask (f)'),
        cape: findPiece('Dizana\'s quiver', 'Charged'),
        neck: findPiece('Necklace of anguish'),
        weapon: findPiece('Bow of faerdhinen', 'Charged'),
        body: findPiece('Masori body (f)'),
        legs: findPiece('Masori chaps (f)'),
        hands: findPiece('Zaryte vambraces'),
        feet: findPiece('Pegasian boots'),
        ring: findPiece('Venator ring'),
      },
    },
  },
  {
    label: 'Max magic (Ancestral + Tumeken\'s shadow, Augury + Saturated heart) vs Vorkath',
    expect: 'Max hit ~60-75 (shadow x3 scaling), accuracy ~50%, DPS ~8-10',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'magic',
      attackStyle: 'magic',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, augury: true },
      potions: { ...noPotions, magic: 'saturated_heart' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Ancestral hat'),
        cape: findPiece('Imbued guthix cape'),
        neck: findPiece('Occult necklace'),
        weapon: findPiece("Tumeken's shadow", 'Charged'),
        body: findPiece('Ancestral robe top'),
        legs: findPiece('Ancestral robe bottom'),
        hands: findPiece('Tormented bracelet'),
        feet: findPiece('Eternal boots'),
        ring: findPiece('Magus ring'),
      },
    },
  },
  {
    label: 'Max magic (Ancestral + Sanguinesti + Elidinis ward, Augury) vs Vorkath',
    expect: 'Max hit ~46-50, Sang max hit at 99 mag = floor(99/3)-1 = 32 base, bumped by gear',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'magic',
      attackStyle: 'magic',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, augury: true },
      potions: { ...noPotions, magic: 'saturated_heart' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Ancestral hat'),
        cape: findPiece('Imbued guthix cape'),
        neck: findPiece('Occult necklace'),
        weapon: findPiece('Sanguinesti staff', 'Charged'),
        shield: findPiece("Elidinis' ward (f)"),
        body: findPiece('Ancestral robe top'),
        legs: findPiece('Ancestral robe bottom'),
        hands: findPiece('Tormented bracelet'),
        feet: findPiece('Eternal boots'),
        ring: findPiece('Magus ring'),
      },
    },
  },
  {
    label: 'Max magic (Fire Surge, Kodai + tome of fire + Ancestral) vs generic training dummy-ish monster',
    expect: 'Fire Surge at 95+ mag = 24 base. Tome of fire gives +50% = 36. With gear: ~40-44',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'magic',
      attackStyle: 'magic',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, augury: true },
      potions: { ...noPotions, magic: 'saturated_heart' },
      onSlayerTask: false,
      inWilderness: false,
      spell: 'Fire Surge',
      equipment: {
        head: findPiece('Ancestral hat'),
        cape: findPiece('Imbued guthix cape'),
        neck: findPiece('Occult necklace'),
        weapon: findPiece('Kodai wand'),
        shield: findPiece('Tome of fire', 'Charged'),
        body: findPiece('Ancestral robe top'),
        legs: findPiece('Ancestral robe bottom'),
        hands: findPiece('Tormented bracelet'),
        feet: findPiece('Eternal boots'),
        ring: findPiece('Magus ring'),
      },
    },
  },
  {
    label: 'Twisted bow vs Zulrah (Serpentine, magic 300)',
    expect: 'Zulrah mag 300 caps TBow mods near max. dmgMult ~2.05x, accMult ~1.18x. Big DPS boost vs BoF',
    monster: findMonster('Zulrah', 'Serpentine'),
    loadout: maxedRangedLoadout('Twisted bow', 'Dragon arrow'),
  },
  {
    label: 'Twisted bow vs low-magic target (Great Olm right claw, mag 87)',
    expect: 'Low magic = TBow penalised. Mods drop well below 100% — BoF should beat TBow here',
    monster: findMonster('Great Olm', 'Right claw'),
    loadout: maxedRangedLoadout('Twisted bow', 'Dragon arrow'),
  },
  {
    label: 'BoF vs Great Olm right claw (comparison to TBow above)',
    expect: 'Reference: BoF should out-DPS TBow on this low-magic target',
    monster: findMonster('Great Olm', 'Right claw'),
    loadout: maxedRangedLoadout('Bow of faerdhinen', 'Dragon arrow'),
  },
  {
    label: 'Emberlight vs K\'ril Tsutsaroth (demon)',
    expect: 'Emberlight +70% dmg & acc vs demon. Expect substantial boost vs non-demonbane sword',
    monster: findMonster("K'ril Tsutsaroth"),
    loadout: {
      style: 'melee',
      attackStyle: 'slash',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece('Emberlight'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'ZCB + Ruby dragon bolts (e) vs Nex (HP 3400)',
    expect: 'Ruby procs 6% for 20% HP (cap 100). Big avg DPS boost over non-proc bolts',
    monster: findMonster('Nex'),
    loadout: maxedRangedLoadout('Zaryte crossbow', 'Ruby dragon bolts (e)'),
  },
  {
    label: "Osmumten's fang (stab) vs Duke Sucellus (Post-quest)",
    expect: 'Fang rerolls low accuracy hits — effective accuracy = 1-(1-p)^2. Outside ToA damage avg unchanged',
    monster: findMonster('Duke Sucellus', 'Post-quest'),
    loadout: {
      style: 'melee',
      attackStyle: 'stab',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece("Osmumten's fang"),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Dual macuahuitl vs Vardorvis (Post-quest)',
    expect: 'Two hits per swing sharing an accuracy roll. Avg per swing ≈ acc × max',
    monster: findMonster('Vardorvis', 'Post-quest'),
    loadout: {
      style: 'melee',
      attackStyle: 'slash',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece('Dual macuahuitl'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Full Elite Void (ranged) + ZCB + Ruby dragon bolts (e) vs Nex',
    expect: 'Elite Void ranged: +10% acc, +12.5% ranged str. Helm + top + robe + gloves required',
    monster: findMonster('Nex'),
    loadout: {
      style: 'ranged',
      attackStyle: 'ranged',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, rigour: true },
      potions: { ...noPotions, ranged: 'divine_ranging' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Void ranger helm', 'Normal'),
        cape: findPiece("Dizana's quiver", 'Charged'),
        neck: findPiece('Necklace of anguish'),
        ammo: findPiece('Ruby dragon bolts (e)'),
        weapon: findPiece('Zaryte crossbow'),
        body: findPiece('Elite void top', 'Normal'),
        legs: findPiece('Elite void robe', 'Normal'),
        hands: findPiece('Void knight gloves', 'Normal'),
        feet: findPiece('Pegasian boots'),
        ring: findPiece('Venator ring'),
      },
    },
  },
  {
    label: 'Full Crystal armour + Bow of Faerdhinen vs Vorkath',
    expect: 'Crystal full set: +15% dmg, +30% acc to BoF. DPS should noticeably exceed Masori+BoF',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'ranged',
      attackStyle: 'ranged',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, rigour: true },
      potions: { ...noPotions, ranged: 'divine_ranging' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Crystal helm', 'Active'),
        cape: findPiece("Dizana's quiver", 'Charged'),
        neck: findPiece('Necklace of anguish'),
        weapon: findPiece('Bow of faerdhinen', 'Charged'),
        body: findPiece('Crystal body', 'Active'),
        legs: findPiece('Crystal legs', 'Active'),
        hands: findPiece('Zaryte vambraces'),
        feet: findPiece('Pegasian boots'),
        ring: findPiece('Venator ring'),
      },
    },
  },
  {
    label: 'Keris partisan of corruption vs Kalphite Queen (kalphite)',
    expect: 'Corruption: +33% dmg & acc vs kalphite. All Keris: avg 1/51 triple-dmg (52/51 ≈ +2%)',
    monster: findMonster('Kalphite Queen', 'Crawling'),
    loadout: {
      style: 'melee',
      attackStyle: 'stab',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece('Keris partisan of corruption'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Harmonised nightmare + Fire Surge vs Vorkath',
    expect: 'Harmonised cuts standard-book cast time 5t→4t. DPS should exceed Kodai+Tome on same spell',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'magic',
      attackStyle: 'magic',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, augury: true },
      potions: { ...noPotions, magic: 'saturated_heart' },
      onSlayerTask: false,
      inWilderness: false,
      spell: 'Fire Surge',
      equipment: {
        head: findPiece('Ancestral hat'),
        cape: findPiece('Imbued guthix cape'),
        neck: findPiece('Occult necklace'),
        weapon: findPiece('Harmonised nightmare staff'),
        shield: findPiece('Tome of fire', 'Charged'),
        body: findPiece('Ancestral robe top'),
        legs: findPiece('Ancestral robe bottom'),
        hands: findPiece('Tormented bracelet'),
        feet: findPiece('Eternal boots'),
        ring: findPiece('Magus ring'),
      },
    },
  },
  {
    label: 'Dragon hunter lance vs Vorkath (dragon)',
    expect: 'DHL +20% dmg & acc vs dragons. Compare to Scythe on same target (~6.4 DPS)',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'melee',
      attackStyle: 'stab',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece('Dragon hunter lance'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Dragon hunter crossbow + Ruby bolts (e) vs Vorkath (dragon)',
    expect: 'DHCB +30% dmg & acc vs dragons. Ruby procs active — top ranged DPS for dragons',
    monster: findMonster('Vorkath', 'Post'),
    loadout: maxedRangedLoadout('Dragon hunter crossbow', 'Ruby dragon bolts (e)'),
  },
  {
    label: 'Scorching bow vs K\'ril Tsutsaroth (demon)',
    expect: 'Scorching bow +30% dmg & acc vs demons. Compares well to Emberlight (6.63 DPS)',
    monster: findMonster("K'ril Tsutsaroth"),
    loadout: maxedRangedLoadout('Scorching bow', 'Dragon arrow'),
  },
  {
    label: 'Obsidian set + Berserker necklace + Tzhaar-ket-om vs Vorkath',
    expect: 'Obsidian set +10% dmg & acc + Berserker +20% dmg = 1.32× dmg, 1.10× acc. Low ceiling without Piety overlap',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'melee',
      attackStyle: 'crush',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Obsidian helmet'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Berserker necklace'),
        weapon: findPiece('Tzhaar-ket-om'),
        body: findPiece('Obsidian platebody'),
        legs: findPiece('Obsidian platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Virtus robes + Ice Barrage (ancient) vs Vorkath',
    expect: 'Virtus full set +9% magic dmg on ancient spells. Ice Barrage base max 30',
    monster: findMonster('Vorkath', 'Post'),
    loadout: {
      style: 'magic',
      attackStyle: 'magic',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, augury: true },
      potions: { ...noPotions, magic: 'saturated_heart' },
      onSlayerTask: false,
      inWilderness: false,
      spell: 'Ice Barrage',
      equipment: {
        head: findPiece('Virtus mask'),
        cape: findPiece('Imbued guthix cape'),
        neck: findPiece('Occult necklace'),
        weapon: findPiece('Kodai wand'),
        shield: findPiece("Elidinis' ward (f)"),
        body: findPiece('Virtus robe top'),
        legs: findPiece('Virtus robe bottom'),
        hands: findPiece('Tormented bracelet'),
        feet: findPiece('Eternal boots'),
        ring: findPiece('Magus ring'),
      },
    },
  },
  {
    label: "Webweaver bow in wilderness vs Vet'ion (Enraged)",
    expect: "Webweaver +50% dmg & acc in wild. Vet'ion is size-3 undead, no Salve here",
    monster: findMonster("Vet'ion", 'Enraged'),
    loadout: {
      ...maxedRangedLoadout('Webweaver bow', 'Dragon arrow'),
      inWilderness: true,
    },
  },
  {
    label: "Webweaver bow OUTSIDE wilderness vs Vet'ion (baseline)",
    expect: 'Same weapon without wilderness flag — no +50% bonus. DPS should be much lower',
    monster: findMonster("Vet'ion", 'Enraged'),
    loadout: {
      ...maxedRangedLoadout('Webweaver bow', 'Dragon arrow'),
      inWilderness: false,
    },
  },
  {
    label: 'Colossal blade vs Callisto (size 5)',
    expect: 'Colossal blade adds +min(size*2,10) flat = +10 to max hit vs size-5 target',
    monster: findMonster('Callisto'),
    loadout: {
      style: 'melee',
      attackStyle: 'slash',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: true,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece('Colossal blade'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
  {
    label: 'Blisterwood flail vs Vyrewatch Sentinel (vampyre3)',
    expect: 'Blisterwood +25% dmg, +5% acc vs T2/T3 vampyres. No Efaritay here',
    monster: findMonster('Vyrewatch Sentinel', '3'),
    loadout: {
      style: 'melee',
      attackStyle: 'crush',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece('Torva full helm'),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece('Blisterwood flail'),
        body: findPiece('Torva platebody'),
        legs: findPiece('Torva platelegs'),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece("Efaritay's aid"),
      },
    },
  },
  {
    label: "Inquisitor's mace + full Inquisitor's set (crush) vs The Nightmare",
    expect: 'Full set gives +2.5% dmg & acc on crush. Nightmare is crush-weak',
    monster: findMonster('The Nightmare'),
    loadout: {
      style: 'melee',
      attackStyle: 'crush',
      skills: { ...maxedSkills },
      prayers: { ...noPrayers, piety: true },
      potions: { ...noPotions, melee: 'super_combat' },
      onSlayerTask: false,
      inWilderness: false,
      spell: null,
      equipment: {
        head: findPiece("Inquisitor's great helm"),
        cape: findPiece('Infernal cape', 'Normal'),
        neck: findPiece('Amulet of torture'),
        weapon: findPiece("Inquisitor's mace"),
        body: findPiece("Inquisitor's hauberk"),
        legs: findPiece("Inquisitor's plateskirt"),
        hands: findPiece('Ferocious gloves'),
        feet: findPiece('Primordial boots'),
        ring: findPiece('Ultor ring'),
      },
    },
  },
];

for (const c of cases) {
  // Sweep stances like the optimizer does; report the DPS-best choice.
  let best: { stance: WeaponStance; r: ReturnType<typeof calcDps> } | null = null;
  for (const s of stancesForStyle(c.loadout.style)) {
    const r = calcDps({ ...c.loadout, stance: s }, c.monster);
    if (!best || r.dps > best.r.dps) best = { stance: s, r };
  }
  const { stance, r } = best!;
  console.log(`\n== ${c.label} ==`);
  console.log(`   expect: ${c.expect}`);
  console.log(`   stance:   ${stance}`);
  console.log(`   max hit:  ${r.maxHit}`);
  console.log(`   accuracy: ${(r.accuracy * 100).toFixed(1)}%`);
  console.log(`   DPS:      ${r.dps.toFixed(3)}`);
  console.log(`   TTK:      ${r.ttkSeconds.toFixed(1)}s`);
  console.log(`   detail:   effAtk=${r.details.effectiveAttack}  effStr=${r.details.effectiveStrength}  atkRoll=${r.details.attackRoll}  defRoll=${r.details.defenceRoll}`);
}
