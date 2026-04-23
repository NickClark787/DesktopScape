import { useMemo, useState } from 'react';
import type { LoadoutSnapshot } from '../state/store';

interface Props {
  saved: Record<string, LoadoutSnapshot>;
  onSave: (name: string) => void;
  onLoad: (name: string) => void;
  onDelete: (name: string) => void;
}

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

export function LoadoutManagerPanel({ saved, onSave, onLoad, onDelete }: Props) {
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const entries = useMemo(
    () => Object.entries(saved).sort((a, b) => b[1].savedAt - a[1].savedAt),
    [saved],
  );

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
  }

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Saved loadouts</span>
        <span className="text-text-faint normal-case">{entries.length} saved</span>
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
              const slotCount = Object.keys(snap.loadout.equipmentIds).length;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-raised border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" title={key}>{key}</div>
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
                        className="btn text-xs text-red-400 border-red-400/40 hover:bg-red-400/10"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="btn text-xs"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(key)}
                      className="btn text-xs hover:text-red-400"
                      title="Delete"
                    >
                      ×
                    </button>
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
