/**
 * Gear + inventory + presets/profiles for the Colosseum tab. Reuses the
 * app's GearGrid + GearPickerModal against the live equipment database.
 */
import { useRef, useState } from 'react';
import type { EquipmentPiece, EquipmentSlot } from '@shared/types';
import { CONSUMABLES } from '@sim/solHeredit/constants';
import type { InventorySlot } from '@sim/solHeredit/types';
import { GearGrid } from '../GearGrid';
import type { ColosseumProfile } from '../../colosseum/profiles';
import type { PresetFile } from '../../colosseum/presets';

type Slot = Exclude<EquipmentSlot, '2h'>;
type Equipment = Partial<Record<Slot, EquipmentPiece | null>>;

export function GearPanel({ equipment, specWeapon, onSlotClick, onSpecClick }: {
  equipment: Equipment;
  specWeapon: EquipmentPiece | null;
  onSlotClick: (slot: Slot) => void;
  onSpecClick: () => void;
}) {
  return (
    <div className="panel">
      <div className="panel-heading">Gear</div>
      <div className="p-3 flex flex-col items-center gap-2">
        <GearGrid equipment={equipment} onSlotClick={onSlotClick} />
        <button className="btn text-xs w-full" onClick={onSpecClick} title="Weapon swapped in when you press the spec key">
          Spec weapon: {specWeapon ? specWeapon.name : 'none (click to pick)'}
        </button>
      </div>
    </div>
  );
}

export function InventoryPanel({ inventory, onChange }: {
  inventory: InventorySlot[];
  onChange: (inv: InventorySlot[]) => void;
}) {
  const set = (i: number, patch: Partial<InventorySlot>) => {
    const next = inventory.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  };
  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Inventory</span>
        <span className="panel-heading-meta">{inventory.filter((s) => s.itemId).length}/28</span>
      </div>
      <div className="p-2 grid grid-cols-4 gap-1">
        {inventory.map((slot, i) => (
          <div key={i} className="flex flex-col gap-0.5 rounded border border-border bg-bg-raised p-1">
            <select
              className="w-full bg-bg-soft border border-border rounded px-1 py-0.5 text-[10px] outline-none focus:border-accent"
              value={slot.itemId ?? ''}
              onChange={(e) => set(i, { itemId: e.target.value || null, qty: e.target.value ? Math.max(1, slot.qty) : 0 })}
            >
              <option value="">—</option>
              {CONSUMABLES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {slot.itemId && (
              <input
                type="number" min={1} max={4} value={slot.qty}
                title="Doses / uses in this slot"
                onChange={(e) => set(i, { qty: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })}
                className="w-full bg-bg-soft border border-border rounded px-1 text-[10px] tabular-nums"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PresetProfilePanel({
  presets, onLoadPreset, profiles, activeName,
  onSaveProfile, onLoadProfile, onDeleteProfile, onRenameProfile, onDuplicateProfile,
  onExportProfile, onImportProfile,
}: {
  presets: PresetFile[];
  onLoadPreset: (p: PresetFile) => void;
  profiles: Record<string, ColosseumProfile>;
  activeName: string | null;
  onSaveProfile: (name: string) => void;
  onLoadProfile: (name: string) => void;
  onDeleteProfile: (name: string) => void;
  onRenameProfile: (from: string, to: string) => void;
  onDuplicateProfile: (name: string) => void;
  onExportProfile: (name: string) => void;
  onImportProfile: (json: string) => void;
}) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="panel">
      <div className="panel-heading">Presets & profiles</div>
      <div className="p-3 flex flex-col gap-2 text-sm">
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <button key={p.name} className="btn text-xs text-left" title={p.description} onClick={() => onLoadPreset(p)}>
              {p.name} <span className="text-text-faint">(preset)</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2 border-t border-border pt-2">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Save current as…"
            className="flex-1 bg-bg-raised border border-border rounded px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <button className="btn btn-primary text-xs" disabled={!name.trim()}
            onClick={() => { onSaveProfile(name.trim()); setName(''); }}>
            Save
          </button>
        </div>

        {Object.keys(profiles).length > 0 && (
          <div className="flex flex-col gap-1">
            {Object.keys(profiles).sort().map((key) => (
              <div key={key} className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${key === activeName ? 'border-accent/70' : 'border-border'} bg-bg-raised`}>
                {renaming === key ? (
                  <>
                    <input autoFocus type="text" value={renameTo} onChange={(e) => setRenameTo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { onRenameProfile(key, renameTo.trim()); setRenaming(null); }
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="flex-1 bg-bg-soft border border-border rounded px-1 outline-none" />
                    <button className="hover:text-accent" onClick={() => { onRenameProfile(key, renameTo.trim()); setRenaming(null); }}>ok</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate" title={key}>{key}</span>
                    <button className="hover:text-accent" title="Load" onClick={() => onLoadProfile(key)}>load</button>
                    <button className="hover:text-accent" title="Rename" onClick={() => { setRenaming(key); setRenameTo(key); }}>ren</button>
                    <button className="hover:text-accent" title="Duplicate" onClick={() => onDuplicateProfile(key)}>dup</button>
                    <button className="hover:text-accent" title="Export JSON" onClick={() => onExportProfile(key)}>exp</button>
                    <button className="hover:text-osrs-red" title="Delete" onClick={() => onDeleteProfile(key)}>×</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <button className="btn text-xs self-start" onClick={() => fileRef.current?.click()}>Import profile JSON</button>
        <input
          ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void f.text().then(onImportProfile);
            e.target.value = '';
          }}
        />
        <p className="text-[11px] text-text-faint leading-snug">
          Presets are read-only — saving forks the current setup into a named profile
          (stored locally, exportable as JSON).
        </p>
      </div>
    </div>
  );
}
