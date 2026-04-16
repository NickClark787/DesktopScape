import { create } from 'zustand';
import type { EquipmentPiece, Monster, CombatStyle, PlayerLoadout, Prayers, Potions } from '@shared/types';
import { DEFAULT_PLAYER_SKILLS } from '@shared/constants';

const defaultPrayers: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};
const defaultPotions: Potions = { melee: 'none', ranged: 'none', magic: 'none' };

export interface AppState {
  loading: boolean;
  equipment: EquipmentPiece[];
  monsters: Monster[];
  selectedMonsterId: number | null;
  style: CombatStyle;
  loadout: PlayerLoadout;
  setStyle: (s: CombatStyle) => void;
  setMonster: (id: number) => void;
  setSkill: (k: keyof PlayerLoadout['skills'], v: number) => void;
  togglePrayer: (k: keyof Prayers) => void;
  setPotion: <K extends keyof Potions>(k: K, v: Potions[K]) => void;
  setOnSlayerTask: (v: boolean) => void;
  setInWilderness: (v: boolean) => void;
  setAttackStyle: (v: PlayerLoadout['attackStyle']) => void;
  hydrate: (data: { equipment: EquipmentPiece[]; monsters: Monster[] }) => void;
  setEquipment: (eq: PlayerLoadout['equipment']) => void;
}

export const useApp = create<AppState>((set) => ({
  loading: true,
  equipment: [],
  monsters: [],
  selectedMonsterId: null,
  style: 'melee',
  loadout: {
    style: 'melee',
    attackStyle: 'slash',
    skills: { ...DEFAULT_PLAYER_SKILLS },
    prayers: { ...defaultPrayers },
    potions: { ...defaultPotions },
    onSlayerTask: false,
    inWilderness: false,
    equipment: {},
  },
  setStyle: (s) => set((st) => ({
    style: s,
    loadout: {
      ...st.loadout,
      style: s,
      attackStyle: s === 'melee' ? 'slash' : s,
    },
  })),
  setMonster: (id) => set({ selectedMonsterId: id }),
  setSkill: (k, v) => set((st) => ({ loadout: { ...st.loadout, skills: { ...st.loadout.skills, [k]: v } } })),
  togglePrayer: (k) => set((st) => ({ loadout: { ...st.loadout, prayers: { ...st.loadout.prayers, [k]: !st.loadout.prayers[k] } } })),
  setPotion: (k, v) => set((st) => ({ loadout: { ...st.loadout, potions: { ...st.loadout.potions, [k]: v } } })),
  setOnSlayerTask: (v) => set((st) => ({ loadout: { ...st.loadout, onSlayerTask: v } })),
  setInWilderness: (v) => set((st) => ({ loadout: { ...st.loadout, inWilderness: v } })),
  setAttackStyle: (v) => set((st) => ({ loadout: { ...st.loadout, attackStyle: v } })),
  hydrate: ({ equipment, monsters }) => set({ equipment, monsters, loading: false }),
  setEquipment: (eq) => set((st) => ({ loadout: { ...st.loadout, equipment: eq } })),
}));
