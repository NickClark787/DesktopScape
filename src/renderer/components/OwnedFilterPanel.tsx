import { useMemo, useState } from 'react';
import fuzzysort from 'fuzzysort';
import type { EquipmentPiece } from '@shared/types';

interface Props {
  equipment: EquipmentPiece[];
  ownedIds: Set<number>;
  enabled: boolean;
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onToggleEnabled: (v: boolean) => void;
}

export function OwnedFilterPanel({
  equipment,
  ownedIds,
  enabled,
  onAdd,
  onRemove,
  onClear,
  onToggleEnabled,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const ownedPieces = useMemo(
    () => equipment.filter((p) => ownedIds.has(p.id)),
    [equipment, ownedIds],
  );

  // Search results — exclude items already owned, cap at 30
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const candidates = equipment.filter((p) => !ownedIds.has(p.id));
    const hits = fuzzysort.go(query, candidates, {
      keys: ['name', 'version'],
      limit: 30,
      threshold: -10000,
    });
    return hits.map((h) => h.obj);
  }, [equipment, ownedIds, query]);

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Owned-only filter</span>
        <span className="text-text-faint normal-case">{ownedIds.size} item{ownedIds.size === 1 ? '' : 's'}</span>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="accent-accent"
          />
          <span>Restrict optimizer to owned items</span>
        </label>

        <button
          className="btn text-xs self-start"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide manager' : 'Manage owned items'}
        </button>

        {open && (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items to add…"
              className="w-full bg-bg-raised border border-border rounded px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {results.length > 0 && (
              <div className="max-h-48 overflow-auto rounded border border-border">
                {results.map((p) => (
                  <button
                    key={`${p.id}-${p.version}`}
                    onClick={() => onAdd(p.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-bg-raised"
                  >
                    <span className="text-accent">+</span>
                    <span className="flex-1 truncate">
                      {p.name}
                      {p.version && <span className="text-text-faint"> · {p.version}</span>}
                    </span>
                    <span className="text-text-faint">{p.slot}</span>
                  </button>
                ))}
              </div>
            )}

            {ownedPieces.length > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-text-faint">
                  <span>Owned ({ownedPieces.length})</span>
                  <button onClick={onClear} className="hover:text-accent">Clear all</button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
                  {ownedPieces.map((p) => (
                    <button
                      key={`${p.id}-${p.version}`}
                      onClick={() => onRemove(p.id)}
                      title="Remove"
                      className="text-xs px-2 py-1 rounded bg-bg-raised border border-border hover:border-accent hover:text-accent flex items-center gap-1.5"
                    >
                      <span>{p.name}{p.version ? ` (${p.version})` : ''}</span>
                      <span className="text-text-faint">×</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
