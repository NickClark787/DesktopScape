import { useMemo, useState } from 'react';
import type { EquipmentPiece, EquipmentSlot } from '@shared/types';
import type { LoadoutSnapshot } from '../state/store';
import { GearIcon } from './GearIcon';

interface Props {
  /** Live equipment list, used to resolve snapshot.equipmentIds → pieces for the preview strip. */
  equipment: EquipmentPiece[];
  saved: Record<string, LoadoutSnapshot>;
  /**
   * Name of the loadout currently reflected in app state, or null when the
   * state has been edited away from a saved snapshot. Drives the "Active"
   * badge so users see at a glance which saved loadout they're viewing.
   * Disappears the moment a destructive action invalidates the match
   * (style switch, gear swap, optimizer run).
   */
  activeName: string | null;
  onSave: (name: string) => void;
  onLoad: (name: string) => void;
  onDelete: (name: string) => void;
}

// Order used for the gear-strip preview. Weapon first because it's the most
// identifiable "this is the loadout" cue; main armor next; accessories last.
// Mirrors the visual hierarchy a player uses to recognize their own setups.
const STRIP_ORDER: ReadonlyArray<Exclude<EquipmentSlot, '2h'>> = [
  'weapon', 'head', 'body', 'legs', 'shield', 'cape', 'neck', 'hands', 'feet', 'ammo', 'ring',
];

function fmtAge(ts: number): string {
  const ageMs = Date.now() - ts;
  const m = Math.round(ageMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function LoadoutManagerPanel({ equipment, saved, activeName, onSave, onLoad, onDelete }: Props) {
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const entries = useMemo(
    () => Object.entries(saved).sort((a, b) => b[1].savedAt - a[1].savedAt),
    [saved],
  );

  // Build a single ID→piece map and reuse for every preview row, instead of
  // O(n) scanning the equipment list per row × per slot. With ~3000 equipment
  // pieces, the saved-loadout list re-renders cheaply.
  const byId = useMemo(() => {
    const m = new Map<number, EquipmentPiece>();
    for (const p of equipment) m.set(p.id, p);
    return m;
  }, [equipment]);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Confirm before silently overwriting an existing snapshot — saving used
    // to be unrecoverable, you'd realize after the fact that you'd lost the
    // saved version.
    if (saved[trimmed] && !window.confirm(`Overwrite saved loadout "${trimmed}"?`)) {
      return;
    }
    onSave(trimmed);
    setName('');
  }

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Saved loadouts</span>
        <span className="panel-heading-meta">{entries.length} saved</span>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder="Name this loadout…"
            className="flex-1 bg-bg-raised border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="btn btn-primary text-xs whitespace-nowrap"
          >
            Save current
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="text-xs text-text-faint italic">
            No saved loadouts yet. Save the current setup to recall it later.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-60 overflow-auto">
            {entries.map(([key, snap]) => {
              const isConfirming = confirmDelete === key;
              const isActive = key === activeName;
              const slotCount = Object.keys(snap.loadout.equipmentIds).length;
              // Resolve snapshot IDs to live pieces. Items removed from upstream
              // data will silently drop out of the strip — same fault-tolerance
              // as the load action itself.
              const stripPieces = STRIP_ORDER
                .map((slot) => byId.get(snap.loadout.equipmentIds[slot] ?? -1))
                .filter((p): p is EquipmentPiece => !!p);
              return (
                <div
                  key={key}
                  className={[
                    'flex flex-col gap-1.5 px-2 py-1.5 rounded bg-bg-raised border',
                    // Gold border on the active row makes it visually pop without
                    // adding a separate badge column. The store clears
                    // loadedLoadoutName the moment any destructive action runs,
                    // so the gold border vanishing IS the "your loadout was just
                    // wiped" feedback.
                    isActive ? 'border-accent/70' : 'border-border',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate flex items-center gap-1.5" title={key}>
                        <span className="truncate">{key}</span>
                        {isActive && (
                          <span className="text-[10px] uppercase tracking-wider text-accent shrink-0 px-1 rounded border border-accent/50 bg-accent/10">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-text-faint">
                        {snap.style} · {slotCount} slot{slotCount === 1 ? '' : 's'} · {fmtAge(snap.savedAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => onLoad(key)}
                      className="btn text-xs"
                      title="Replace current state with this loadout"
                    >
                      Load
                    </button>
                    {isConfirming ? (
                      <>
                        <button
                          onClick={() => { onDelete(key); setConfirmDelete(null); }}
                          className="btn text-xs text-style-melee border-style-melee/40 hover:bg-style-melee/10"
                          aria-label={`Confirm delete loadout ${key}`}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="btn text-xs"
                          aria-label="Cancel delete"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(key)}
                        className="btn text-xs hover:text-style-melee"
                        title="Delete"
                        aria-label={`Delete loadout ${key}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {stripPieces.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {stripPieces.map((p) => (
                        <GearIcon key={`${p.slot}-${p.id}`} piece={p} size="xs" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
