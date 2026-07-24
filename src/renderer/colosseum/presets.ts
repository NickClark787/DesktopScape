/**
 * Colosseum presets are declarative JSON files under ./presets — item NAMES,
 * not object graphs — resolved against the live equipment database at load
 * time. Adding a preset = dropping a JSON file and listing it here (see the
 * sim README for the schema). Presets are read-only; "saving" one forks it
 * into a user profile.
 */
import type { EquipmentPiece, EquipmentSlot, PlayerSkills, WeaponStance } from '@shared/types';
import type { InventorySlot, LatencyConfig } from '@sim/solHeredit/types';
import bisStandard from './presets/bis-standard.json';
import lowTier from './presets/low-tier.json';

type Slot = Exclude<EquipmentSlot, '2h'>;

export interface PresetFile {
  name: string;
  description: string;
  gear: Partial<Record<Slot, string>>;
  gearVersions: Partial<Record<Slot, string>>;
  attackStyle: string;
  stance: string;
  inventory: { item: string; qty: number }[];
  skills: PlayerSkills;
  settings: { latency: LatencyConfig };
}

export const PRESET_FILES: PresetFile[] = [
  bisStandard as PresetFile,
  lowTier as PresetFile,
];

export interface ResolvedPreset {
  name: string;
  description: string;
  equipment: Partial<Record<Slot, EquipmentPiece | null>>;
  attackStyle: 'stab' | 'slash' | 'crush';
  stance: WeaponStance;
  inventory: InventorySlot[];
  skills: PlayerSkills;
  latency: LatencyConfig;
}

/** Resolve a preset's item names against the equipment DB. Unknown names
 *  are skipped with a warning rather than failing the preset. */
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
      console.warn(`[colosseum] preset "${file.name}": unknown item "${name}" for ${slot}`);
      continue;
    }
    eq[slot] = piece;
  }
  const inventory: InventorySlot[] = [];
  for (const row of file.inventory) {
    for (let i = 0; i < row.qty && inventory.length < 28; i++) {
      inventory.push({ itemId: row.item, qty: 1 });
    }
  }
  while (inventory.length < 28) inventory.push({ itemId: null, qty: 0 });
  return {
    name: file.name,
    description: file.description,
    equipment: eq,
    attackStyle: (['stab', 'slash', 'crush'].includes(file.attackStyle) ? file.attackStyle : 'slash') as 'stab' | 'slash' | 'crush',
    stance: (file.stance || 'aggressive') as WeaponStance,
    inventory,
    skills: { ...file.skills },
    latency: { ...file.settings.latency },
  };
}
