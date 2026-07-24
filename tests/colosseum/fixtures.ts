/** Shared fixtures for the Sol Heredit simulator tests. */
import type { EquipmentPiece, Monster, PlayerLoadout, StyleStats } from '@shared/types';
import type { SimConfig } from '@sim/solHeredit/types';

const ZERO_STATS: StyleStats = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 };

export function piece(overrides: Partial<EquipmentPiece> & Pick<EquipmentPiece, 'name' | 'slot'>): EquipmentPiece {
  return {
    id: 0, version: '', image: '', weight: 0, speed: 4, category: '',
    bonuses: { str: 0, ranged_str: 0, magic_str: 0, prayer: 0 },
    offensive: { ...ZERO_STATS }, defensive: { ...ZERO_STATS }, isTwoHanded: false,
    ...overrides,
  };
}

/** Sol Heredit's real stats (monsters.json id 12821 / wiki infobox). */
export function solMonster(): Monster {
  return {
    id: 12821, name: 'Sol Heredit', version: '', image: '', level: 1563, speed: 0,
    style: ['Melee'], size: 5, max_hit: '44',
    skills: { atk: 350, def: 200, hp: 1500, magic: 300, ranged: 350, str: 400 },
    offensive: { atk: 250, str: 5, magic: 0, magic_str: 0, ranged: 150, ranged_str: 0 },
    defensive: { flat_armour: 0, stab: 65, slash: 5, crush: 30, magic: 750, heavy: 825, standard: 825, light: 825 },
    attributes: [], immunities: null, is_slayer_monster: false, weakness: null,
  };
}

export function meleeLoadout(): PlayerLoadout {
  return {
    style: 'melee',
    attackStyle: 'slash',
    stance: 'aggressive',
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
        name: 'Abyssal whip', slot: 'weapon', category: 'Whip', speed: 4,
        offensive: { ...ZERO_STATS, slash: 82 },
        bonuses: { str: 82, ranged_str: 0, magic_str: 0, prayer: 0 },
      }),
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
  const loadout = meleeLoadout();
  // Big HP keeps timing-focused tests from ending in deaths mid-scenario.
  const hp = overrides.playerHp ?? 5000;
  loadout.skills = { ...loadout.skills, hp };
  return {
    seed: overrides.seed ?? 1234,
    monster: solMonster(),
    latency: { pingMs: 0, jitterMs: 0, packetLossPct: 0, ...overrides.latency },
    boss: {
      startHpPct: 100,
      enabledTransitions: [],
      modifierIds: [],
      forcedRotation: [],
      infiniteHp: false,
      practiceMode: 'full',
      practicePhase: 0,
      ...overrides.boss,
    },
    assists: { hazardOverlay: false, nextAttackPrediction: false, prayerTimingIndicator: false, safeTileHighlight: false },
    player: {
      skills: loadout.skills,
      loadout,
      gearSets: [],
      inventory: [],
      specs: [],
    },
  };
}
