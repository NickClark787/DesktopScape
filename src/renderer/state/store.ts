import { create } from 'zustand';
import type { EquipmentPiece, EquipmentSlot, Monster, CombatStyle, PlayerLoadout, Prayers, Potions, RaidScaling, WeaponStance, MeleeAttackType } from '@shared/types';
import { DEFAULT_PLAYER_SKILLS } from '@shared/constants';
import type { DataMeta } from '../../preload';

/**
 * Saved-loadout snapshot. Equipment is stored as IDs only — the renderer
 * resolves them against the live equipment list on load, so a snapshot is
 * portable across data refreshes (silently drops items removed upstream).
 */
export interface LoadoutSnapshot {
  version: 1;
  savedAt: number;
  style: CombatStyle;
  selectedMonsterId: number | null;
  loadout: {
    style: CombatStyle;
    attackStyle: PlayerLoadout['attackStyle'];
    skills: PlayerLoadout['skills'];
    prayers: Prayers;
    potions: Potions;
    onSlayerTask: boolean;
    inWilderness: boolean;
    spell: string | null;
    stance?: WeaponStance;
    raidScaling?: RaidScaling;
    equipmentIds: Partial<Record<Exclude<EquipmentSlot, '2h'>, number>>;
  };
  stanceOverride: WeaponStance | null;
  attackStyleOverride: MeleeAttackType | null;
}

const OWNED_LS_KEY = 'gearscape:ownedIds';
const OWNED_FILTER_LS_KEY = 'gearscape:ownedFilterEnabled';

function loadOwnedIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(OWNED_LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : []);
  } catch { return new Set(); }
}
function saveOwnedIds(ids: Set<number>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(OWNED_LS_KEY, JSON.stringify([...ids])); } catch { /* ignore quota */ }
}
function loadOwnedFilterEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(OWNED_FILTER_LS_KEY) === '1';
}
function saveOwnedFilterEnabled(v: boolean): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(OWNED_FILTER_LS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

const LOADOUTS_LS_KEY = 'gearscape:loadouts';

function loadSavedLoadouts(): Record<string, LoadoutSnapshot> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOADOUTS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, LoadoutSnapshot>;
    return {};
  } catch { return {}; }
}
function persistSavedLoadouts(rec: Record<string, LoadoutSnapshot>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LOADOUTS_LS_KEY, JSON.stringify(rec)); } catch { /* ignore quota */ }
}

const defaultPrayers: Prayers = {
  piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
  burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
  rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
  augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
};
const defaultPotions: Potions = { melee: 'none', ranged: 'none', magic: 'none' };

export interface AppState {
  loading: boolean;
  /** Data file freshness — drives the staleness chip in the header. Null until first hydrate. */
  dataMeta: DataMeta | null;
  equipment: EquipmentPiece[];
  monsters: Monster[];
  selectedMonsterId: number | null;
  style: CombatStyle;
  loadout: PlayerLoadout;
  /** Pinned stance — null means "let the optimizer pick". */
  stanceOverride: WeaponStance | null;
  /** Pinned melee attack style — null means "let the optimizer pick". */
  attackStyleOverride: MeleeAttackType | null;
  setStanceOverride: (v: WeaponStance | null) => void;
  setAttackStyleOverride: (v: MeleeAttackType | null) => void;
  /** Owned-only filter — restricts the optimizer to items in `ownedIds`. */
  ownedIds: Set<number>;
  ownedFilterEnabled: boolean;
  addOwned: (id: number) => void;
  removeOwned: (id: number) => void;
  clearOwned: () => void;
  setOwnedFilterEnabled: (v: boolean) => void;
  /** Saved loadouts keyed by user-supplied name. Persisted to localStorage. */
  savedLoadouts: Record<string, LoadoutSnapshot>;
  saveLoadout: (name: string) => void;
  loadLoadout: (name: string) => void;
  deleteLoadout: (name: string) => void;
  setStyle: (s: CombatStyle) => void;
  setMonster: (id: number) => void;
  setSkill: (k: keyof PlayerLoadout['skills'], v: number) => void;
  togglePrayer: (k: keyof Prayers) => void;
  setPotion: <K extends keyof Potions>(k: K, v: Potions[K]) => void;
  setOnSlayerTask: (v: boolean) => void;
  setInWilderness: (v: boolean) => void;
  setAttackStyle: (v: PlayerLoadout['attackStyle']) => void;
  /**
   * Sets the loadout's attack stance directly (separate from the optimizer
   * override). Used by the gear picker after a weapon swap so the displayed
   * DPS reflects the stance the picker computed it under.
   */
  setStance: (v: WeaponStance | undefined) => void;
  setSpell: (v: string | null) => void;
  setRaidScaling: (v: RaidScaling | undefined) => void;
  hydrate: (data: { equipment: EquipmentPiece[]; monsters: Monster[]; meta?: DataMeta }) => void;
  setEquipment: (eq: PlayerLoadout['equipment']) => void;
  /**
   * Per-slot manual override. Pass `null` to unequip. Handles the 2h⇆shield
   * mutual exclusion automatically: equipping a 2h weapon clears the shield;
   * equipping a shield over a 2h weapon clears the weapon.
   */
  setSlot: (slot: Exclude<EquipmentSlot, '2h'>, piece: EquipmentPiece | null) => void;
}

export const useApp = create<AppState>((set) => ({
  loading: true,
  dataMeta: null,
  equipment: [],
  monsters: [],
  selectedMonsterId: null,
  style: 'melee',
  stanceOverride: null,
  attackStyleOverride: null,
  setStanceOverride: (v) => set({ stanceOverride: v }),
  setAttackStyleOverride: (v) => set({ attackStyleOverride: v }),
  ownedIds: loadOwnedIds(),
  ownedFilterEnabled: loadOwnedFilterEnabled(),
  addOwned: (id) => set((st) => {
    const next = new Set(st.ownedIds);
    next.add(id);
    saveOwnedIds(next);
    return { ownedIds: next };
  }),
  removeOwned: (id) => set((st) => {
    const next = new Set(st.ownedIds);
    next.delete(id);
    saveOwnedIds(next);
    return { ownedIds: next };
  }),
  clearOwned: () => { saveOwnedIds(new Set()); set({ ownedIds: new Set() }); },
  setOwnedFilterEnabled: (v) => { saveOwnedFilterEnabled(v); set({ ownedFilterEnabled: v }); },
  savedLoadouts: loadSavedLoadouts(),
  saveLoadout: (name) => set((st) => {
    const trimmed = name.trim();
    if (!trimmed) return {};
    const equipmentIds: Partial<Record<Exclude<EquipmentSlot, '2h'>, number>> = {};
    for (const [slot, piece] of Object.entries(st.loadout.equipment)) {
      if (piece) equipmentIds[slot as Exclude<EquipmentSlot, '2h'>] = piece.id;
    }
    const snap: LoadoutSnapshot = {
      version: 1,
      savedAt: Date.now(),
      style: st.style,
      selectedMonsterId: st.selectedMonsterId,
      loadout: {
        style: st.loadout.style,
        attackStyle: st.loadout.attackStyle,
        skills: { ...st.loadout.skills },
        prayers: { ...st.loadout.prayers },
        potions: { ...st.loadout.potions },
        onSlayerTask: st.loadout.onSlayerTask,
        inWilderness: st.loadout.inWilderness,
        spell: st.loadout.spell,
        stance: st.loadout.stance,
        raidScaling: st.loadout.raidScaling,
        equipmentIds,
      },
      stanceOverride: st.stanceOverride,
      attackStyleOverride: st.attackStyleOverride,
    };
    const next = { ...st.savedLoadouts, [trimmed]: snap };
    persistSavedLoadouts(next);
    return { savedLoadouts: next };
  }),
  loadLoadout: (name) => set((st) => {
    const snap = st.savedLoadouts[name];
    if (!snap) return {};
    // Resolve equipment IDs against current data; missing items silently skipped.
    const byId = new Map(st.equipment.map((p) => [p.id, p] as const));
    const equipment: PlayerLoadout['equipment'] = {};
    for (const [slot, id] of Object.entries(snap.loadout.equipmentIds)) {
      const piece = byId.get(id as number);
      if (piece) equipment[slot as Exclude<EquipmentSlot, '2h'>] = piece;
    }
    return {
      style: snap.style,
      selectedMonsterId: snap.selectedMonsterId,
      stanceOverride: snap.stanceOverride,
      attackStyleOverride: snap.attackStyleOverride,
      loadout: {
        style: snap.loadout.style,
        attackStyle: snap.loadout.attackStyle,
        skills: { ...snap.loadout.skills },
        prayers: { ...snap.loadout.prayers },
        potions: { ...snap.loadout.potions },
        onSlayerTask: snap.loadout.onSlayerTask,
        inWilderness: snap.loadout.inWilderness,
        spell: snap.loadout.spell,
        stance: snap.loadout.stance,
        raidScaling: snap.loadout.raidScaling,
        equipment,
      },
    };
  }),
  deleteLoadout: (name) => set((st) => {
    if (!(name in st.savedLoadouts)) return {};
    const next = { ...st.savedLoadouts };
    delete next[name];
    persistSavedLoadouts(next);
    return { savedLoadouts: next };
  }),
  loadout: {
    style: 'melee',
    attackStyle: 'slash',
    skills: { ...DEFAULT_PLAYER_SKILLS },
    prayers: { ...defaultPrayers },
    potions: { ...defaultPotions },
    onSlayerTask: false,
    inWilderness: false,
    equipment: {},
    spell: null,
  },
  setStyle: (s) => set((st) => ({
    style: s,
    stanceOverride: null,
    attackStyleOverride: null,
    loadout: {
      ...st.loadout,
      style: s,
      attackStyle: s === 'melee' ? 'slash' : s,
      // Equipment from the prior style is invalid for the new one — a melee
      // weapon doesn't make sense once the user is on the Ranged tab. Wipe
      // so the gear grid resets and the picker's substitution baseline is
      // clean. The user gets the empty grid + "click any slot" nudge, or
      // can re-run Find best setup to repopulate.
      equipment: {},
      // Stance is also weapon-coupled; unset so the engine picks the
      // default for whatever weapon gets equipped next.
      stance: undefined,
    },
  })),
  setMonster: (id) => set({ selectedMonsterId: id }),
  setSkill: (k, v) => set((st) => ({ loadout: { ...st.loadout, skills: { ...st.loadout.skills, [k]: v } } })),
  togglePrayer: (k) => set((st) => ({ loadout: { ...st.loadout, prayers: { ...st.loadout.prayers, [k]: !st.loadout.prayers[k] } } })),
  setPotion: (k, v) => set((st) => ({ loadout: { ...st.loadout, potions: { ...st.loadout.potions, [k]: v } } })),
  setOnSlayerTask: (v) => set((st) => ({ loadout: { ...st.loadout, onSlayerTask: v } })),
  setInWilderness: (v) => set((st) => ({ loadout: { ...st.loadout, inWilderness: v } })),
  setAttackStyle: (v) => set((st) => ({ loadout: { ...st.loadout, attackStyle: v } })),
  setStance: (v) => set((st) => ({ loadout: { ...st.loadout, stance: v } })),
  setSpell: (v) => set((st) => ({ loadout: { ...st.loadout, spell: v } })),
  setRaidScaling: (v) => set((st) => ({ loadout: { ...st.loadout, raidScaling: v } })),
  hydrate: ({ equipment, monsters, meta }) => set({ equipment, monsters, loading: false, dataMeta: meta ?? null }),
  setEquipment: (eq) => set((st) => ({ loadout: { ...st.loadout, equipment: eq } })),
  setSlot: (slot, piece) => set((st) => {
    const next = { ...st.loadout.equipment };
    if (piece === null) {
      next[slot] = null;
    } else {
      next[slot] = piece;
      // 2h⇆shield mutual exclusion. Mirrors the optimizer's loadout assembly so
      // the manual picker can't produce a state the engine would never propose.
      if (slot === 'weapon' && piece.isTwoHanded) next.shield = null;
      else if (slot === 'shield' && next.weapon?.isTwoHanded) next.weapon = null;
    }
    return { loadout: { ...st.loadout, equipment: next } };
  }),
}));
