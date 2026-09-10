/** Shared fixtures for the TzKal-Zuk simulator tests. */
import type { EquipmentPiece, Monster, PlayerLoadout, StyleStats } from '@shared/types';
import type { EntityKind, SimConfig } from '@sim/tzkalZuk/types';

const ZERO_STATS: StyleStats = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 };

export function piece(overrides: Partial<EquipmentPiece> & Pick<EquipmentPiece, 'name' | 'slot'>): EquipmentPiece {
  return {
    id: 0, version: '', image: '', weight: 0, speed: 4, category: '',
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS }, defensive: { ...ZERO_STATS }, isTwoHanded: false,
    ...overrides,
  };
}

function mon(overrides: Partial<Monster> & { name: string; id: number }): Monster {
  const skills = { atk: 1, def: 1, hp: 100, magic: 1, ranged: 1, str: 1, ...(overrides.skills ?? {}) };
  return {
    version: '', image: '', level: 100, speed: 4, style: [], size: 5, max_hit: '0',
    offensive: { atk: 0, str: 0, magic: 0, magic_str: 0, ranged: 0, ranged_str: 0 },
    defensive: { flat_armour: 0, stab: 0, slash: 0, crush: 0, magic: 0, heavy: 0, standard: 0, light: 0 },
    attributes: [], immunities: null, is_slayer_monster: false, weakness: null,
    ...overrides,
    skills,
  };
}

/**
 * Monster rows below are copied from the bundled raw wiki data
 * (`resources/data/monsters.json`) so the fixtures test the same numbers the
 * app runs on — levels, sizes, speeds and offensive bonuses included. The
 * offensive bonuses matter now that monsters roll accuracy against the
 * player (`sim/tzkalZuk/npcCombat.ts`).
 */
export function zukMonster(): Monster {
  return mon({
    id: 7706, name: 'TzKal-Zuk', version: 'Normal', level: 1400, size: 7, speed: 10, max_hit: '148',
    skills: { atk: 350, def: 260, hp: 1200, magic: 150, ranged: 400, str: 600 },
    offensive: { atk: 0, str: 200, magic: 550, magic_str: 450, ranged: 550, ranged_str: 200 },
    defensive: { flat_armour: 0, stab: 0, slash: 0, crush: 0, magic: 350, heavy: 100, standard: 100, light: 100 },
    weakness: { element: 'water', severity: 40 },
  });
}

export function addMonsters(): Partial<Record<EntityKind, Monster>> {
  return {
    ranger: mon({
      id: 7698, name: 'Jal-Xil', level: 370, size: 3, speed: 4, max_hit: '46 (Ranged)',
      skills: { atk: 140, def: 60, hp: 125, magic: 90, ranged: 250, str: 180 },
      offensive: { atk: 0, str: 0, magic: 0, magic_str: 0, ranged: 40, ranged_str: 50 },
    }),
    mager: mon({
      id: 7699, name: 'Jal-Zek', level: 490, size: 4, speed: 4, max_hit: '70 (Magic)',
      skills: { atk: 370, def: 260, hp: 220, magic: 300, ranged: 510, str: 510 },
      offensive: { atk: 0, str: 0, magic: 80, magic_str: 0, ranged: 0, ranged_str: 0 },
    }),
    jad: mon({
      id: 7700, name: 'JalTok-Jad', level: 900, size: 5, speed: 8, max_hit: '113',
      skills: { atk: 750, def: 480, hp: 350, magic: 510, ranged: 1020, str: 1020 },
      offensive: { atk: 0, str: 0, magic: 100, magic_str: 75, ranged: 80, ranged_str: 0 },
    }),
    healer: mon({
      id: 7708, name: 'Jal-MejJak', level: 250, size: 1, speed: 3, max_hit: '10',
      skills: { atk: 1, def: 100, hp: 75, magic: 1, ranged: 1, str: 1 },
    }),
    jadHealer: mon({
      id: 7701, name: 'Yt-HurKot', version: 'Level 141', level: 141, size: 1, speed: 4, max_hit: '18',
      skills: { atk: 165, def: 100, hp: 90, magic: 150, ranged: 150, str: 125 },
      offensive: { atk: 0, str: 0, magic: 100, magic_str: 0, ranged: 80, ranged_str: 0 },
      defensive: { flat_armour: 0, stab: 0, slash: 0, crush: 0, magic: 130, heavy: 130, standard: 130, light: 130 },
    }),
  };
}

export function rangedLoadout(): PlayerLoadout {
  return {
    style: 'ranged',
    attackStyle: 'ranged',
    stance: 'rapid',
    skills: { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
    prayers: {
      piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
      burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
      rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
      augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
    },
    potions: { melee: 'none', ranged: 'none', magic: 'none' },
    onSlayerTask: false, inWilderness: false,
    equipment: {
      weapon: piece({
        name: 'Twisted bow', slot: 'weapon', category: 'Bow', isTwoHanded: true, speed: 5,
        offensive: { ...ZERO_STATS, ranged: 70 }, bonuses: { str: 0, ranged_str: 20, magic_str: 0, prayer: 0 },
      }),
      ammo: piece({ name: 'Dragon arrow', slot: 'ammo', bonuses: { str: 0, ranged_str: 60, magic_str: 0, prayer: 0 } }),
    },
    spell: null,
  };
}

export function baseConfig(overrides: {
  seed?: number;
  latency?: Partial<SimConfig['latency']>;
  boss?: Partial<SimConfig['boss']>;
  playerHp?: number;
} = {}): SimConfig {
  const loadout = rangedLoadout();
  const hp = overrides.playerHp ?? 5000; // high HP keeps timing tests alive
  loadout.skills = { ...loadout.skills, hp };
  return {
    seed: overrides.seed ?? 4242,
    monster: zukMonster(),
    addMonsters: addMonsters(),
    latency: { pingMs: 0, jitterMs: 0, packetLossPct: 0, ...overrides.latency },
    boss: {
      startHpPct: 100,
      modifierIds: [],
      freezeGlyph: false,
      practiceMode: 'full',
      ...overrides.boss,
    },
    assists: { glyphSafeHighlight: false, addTimers: false, jadPrayerIndicator: false, setCountdown: false },
    player: { skills: loadout.skills, loadout, gearSets: [], inventory: [] },
  };
}
