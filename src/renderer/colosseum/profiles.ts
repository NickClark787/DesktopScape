/**
 * Saved Colosseum profiles: gear + inventory + stats + settings under a
 * user-chosen name. Persisted to localStorage under a VERSIONED key with a
 * migration path — bump `STORE_VERSION`, add a case to `migrate`, done.
 */
import type { EquipmentPiece, EquipmentSlot, PlayerSkills } from '@shared/types';
import type { AssistOptions, BossOptions, InventorySlot, LatencyConfig } from '@sim/solHeredit/types';

type Slot = Exclude<EquipmentSlot, '2h'>;

const STORE_KEY = 'desktopscape:colosseum:profiles';
const STORE_VERSION = 1;

export interface ColosseumProfile {
  savedAt: number;
  /** Equipment stored as ids (with versions) — portable across refreshes. */
  gear: Partial<Record<Slot, { id: number; version: string }>>;
  inventory: InventorySlot[];
  skills: PlayerSkills;
  latency: LatencyConfig;
  boss: BossOptions;
  assists: AssistOptions;
  attackStyle: string;
  stance: string;
}

interface Store {
  version: number;
  profiles: Record<string, ColosseumProfile>;
}

function emptyStore(): Store {
  return { version: STORE_VERSION, profiles: {} };
}

/** Version migrations run oldest-first; unknown/corrupt data resets. */
function migrate(raw: unknown): Store {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const store = raw as Partial<Store>;
  if (typeof store.version !== 'number' || !store.profiles) return emptyStore();
  // Future: if (store.version === 1) { ...upgrade to 2...; store.version = 2; }
  if (store.version !== STORE_VERSION) return emptyStore();
  return store as Store;
}

export function loadProfiles(): Record<string, ColosseumProfile> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? migrate(JSON.parse(raw)).profiles : {};
  } catch {
    return {};
  }
}

function persist(profiles: Record<string, ColosseumProfile>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ version: STORE_VERSION, profiles }));
  } catch { /* quota */ }
}

export function saveProfile(name: string, profile: ColosseumProfile): Record<string, ColosseumProfile> {
  const all = loadProfiles();
  all[name] = profile;
  persist(all);
  return all;
}

export function deleteProfile(name: string): Record<string, ColosseumProfile> {
  const all = loadProfiles();
  delete all[name];
  persist(all);
  return all;
}

export function renameProfile(from: string, to: string): Record<string, ColosseumProfile> {
  const all = loadProfiles();
  if (all[from] && to.trim() && !all[to]) {
    all[to] = all[from];
    delete all[from];
    persist(all);
  }
  return all;
}

export function duplicateProfile(name: string): Record<string, ColosseumProfile> {
  const all = loadProfiles();
  const src = all[name];
  if (src) {
    let copy = `${name} (copy)`;
    let i = 2;
    while (all[copy]) copy = `${name} (copy ${i++})`;
    all[copy] = { ...src, savedAt: Date.now() };
    persist(all);
  }
  return all;
}

export function exportProfile(name: string): string | null {
  const p = loadProfiles()[name];
  return p ? JSON.stringify({ version: STORE_VERSION, name, profile: p }, null, 2) : null;
}

export function importProfile(json: string): { name: string; profiles: Record<string, ColosseumProfile> } {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('not a profile export');
  const { version, name, profile } = parsed as { version?: number; name?: string; profile?: ColosseumProfile };
  if (version !== STORE_VERSION || !name || !profile) throw new Error('unrecognized profile format');
  return { name, profiles: saveProfile(name, profile) };
}

/** Resolve a stored gear map back to live pieces (missing items dropped). */
export function resolveProfileGear(
  gear: ColosseumProfile['gear'],
  equipment: EquipmentPiece[],
): Partial<Record<Slot, EquipmentPiece | null>> {
  const byKey = new Map(equipment.map((p) => [`${p.id}|${p.version}`, p] as const));
  const byId = new Map<number, EquipmentPiece>();
  for (const p of equipment) if (!byId.has(p.id)) byId.set(p.id, p);
  const out: Partial<Record<Slot, EquipmentPiece | null>> = {};
  for (const [slot, ref] of Object.entries(gear) as [Slot, { id: number; version: string }][]) {
    const piece = byKey.get(`${ref.id}|${ref.version}`) ?? byId.get(ref.id);
    if (piece) out[slot] = piece;
  }
  return out;
}
