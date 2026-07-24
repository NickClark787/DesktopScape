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

export function zukMonster(): Monster {
  return mon({
    id: 7706, name: 'TzKal-Zuk', version: 'Normal', level: 1400, size: 7, speed: 10, max_hit: '148',
    skills: { atk: 350, def: 260, hp: 1200, magic: 150, ranged: 350, str: 400 },
    defensive: { flat_armour: 0, stab: 0, slash: 0, crush: 0, magic: 350, heavy: 100, standard: 100, light: 100 },
    weakness: { element: 'water', severity: 40 },
  });
}

export function addMonsters(): Partial<Record<EntityKind, Monster>> {
  return {
    ranger: mon({ id: 7698, name: 'Jal-Xil', size: 3, skills: { atk: 1, def: 60, hp: 125, magic: 90, ranged: 1, str: 1 } }),
    mager: mon({ id: 7699, name: 'Jal-Zek', size: 3, skills: { atk: 1, def: 260, hp: 220, magic: 300, ranged: 1, str: 1 } }),
    jad: mon({ id: 7700, name: 'JalTok-Jad', size: 5, skills: { atk: 1, def: 480, hp: 350, magic: 510, ranged: 1, str: 1 } }),
    healer: mon({ id: 7708, name: 'Jal-MejJak', size: 2, skills: { atk: 1, def: 100, hp: 75, magic: 1, ranged: 1, str: 1 } }),
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
