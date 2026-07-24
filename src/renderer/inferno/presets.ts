/**
 * Inferno presets — declarative JSON (item names, not object graphs)
 * resolved against the live equipment DB. Add a preset by dropping a JSON
 * file in ./presets and listing it here. Presets are read-only; saving one
 * forks it into a user profile.
 */
import type { EquipmentPiece, EquipmentSlot, PlayerSkills } from '@shared/types';
import type { InventorySlot, LatencyConfig } from '@sim/tzkalZuk/types';
import bisRanged from './presets/bis-ranged.json';
import budgetRanged from './presets/budget-ranged.json';

type Slot = Exclude<EquipmentSlot, '2h'>;

export interface PresetFile {
  name: string;
  description: string;
  gear: Partial<Record<Slot, string>>;
  gearVersions: Partial<Record<Slot, string>>;
  inventory: { item: string; qty: number }[];
  skills: PlayerSkills;
  settings: { latency: LatencyConfig };
}

export const PRESET_FILES: PresetFile[] = [bisRanged as PresetFile, budgetRanged as PresetFile];

export interface ResolvedPreset {
  name: string;
  description: string;
  equipment: Partial<Record<Slot, EquipmentPiece | null>>;
  inventory: InventorySlot[];
  skills: PlayerSkills;
  latency: LatencyConfig;
}

export function resolvePreset(file: PresetFile, equipment: EquipmentPiece[]): ResolvedPreset {
  const eq: ResolvedPreset['equipment'] = {};
  for (const [slot, name] of Object.entries(file.gear) as [Slot, string][]) {
    const wantVersion = file.gearVersions[slot];
    const matches = equipment.filter((p) => p.name === name);
    const piece = wantVersion !== undefined
      ? matches.find((p) => p.version === wantVersion) ?? matches[0]
      : matches[0];
    if (!piece) {
      // eslint-disable-next-line no-console
      console.warn(`[inferno] preset "${file.name}": unknown item "${name}" for ${slot}`);
      continue;
    }
    eq[slot] = piece;
  }
  const inventory: InventorySlot[] = [];
  for (const row of file.inventory) {
    for (let i = 0; i < row.qty && inventory.length < 28; i++) inventory.push({ itemId: row.item, qty: 1 });
  }
  while (inventory.length < 28) inventory.push({ itemId: null, qty: 0 });
  return {
    name: file.name,
    description: file.description,
    equipment: eq,
    inventory,
    skills: { ...file.skills },
    latency: { ...file.settings.latency },
  };
}
