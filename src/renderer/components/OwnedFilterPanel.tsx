import { useMemo, useState } from 'react';
import fuzzysort from 'fuzzysort';
import type { EquipmentPiece } from '@shared/types';
import { GearIcon } from './GearIcon';
import { parseBankItemIds } from '../utils/parseBankExport';

interface Props {
  equipment: EquipmentPiece[];
  ownedIds: Set<number>;
  enabled: boolean;
  onAdd: (id: number) => void;
  /** Bulk-add ids parsed from a pasted bank export. */
  onImport: (ids: number[]) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onToggleEnabled: (v: boolean) => void;
}

export function OwnedFilterPanel({
  equipment,
  ownedIds,
  enabled,
  onAdd,
  onImport,
  onRemove,
  onClear,
  onToggleEnabled,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importMsg, setImportMsg] = useState('');

  const ownedPieces = useMemo(
    () => equipment.filter((p) => ownedIds.has(p.id)),
    [equipment, ownedIds],
  );

  // Set of every real equipment id, used to drop non-gear rows (food, runes,
  // teleports…) from a pasted bank so only wearable items enter the filter.
  const equipIds = useMemo(() => new Set(equipment.map((e) => e.id)), [equipment]);

  function handleImport() {
    const parsed = parseBankItemIds(pasteText);
    const matched = parsed.filter((id) => equipIds.has(id));
    onImport(matched);
    if (parsed.length === 0) {
      setImportMsg('No item rows found — each line should start with an item id.');
    } else if (matched.length === 0) {
      setImportMsg(`0 of ${parsed.length} pasted rows matched gear (non-wearable items are ignored).`);
    } else {
      setImportMsg(`Matched ${matched.length} gear item${matched.length === 1 ? '' : 's'} from ${parsed.length} pasted row${parsed.length === 1 ? '' : 's'}.`);
    }
  }

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
        <span className="panel-heading-meta">{ownedIds.size} item{ownedIds.size === 1 ? '' : 's'}</span>
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
                    <GearIcon piece={p} size="sm" />
                    <span className="flex-1 truncate">
                      {p.name}
                      {p.version && <span className="text-text-faint"> · {p.version}</span>}
                    </span>
                    <span className="text-text-faint">{p.slot}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Bulk import from a RuneLite-style bank export (id / name / qty). */}
            <div className="border-t border-border pt-3 flex flex-col gap-2">
              <button
                className="btn text-xs self-start"
                onClick={() => setPasteOpen((v) => !v)}
              >
                {pasteOpen ? 'Hide bank import' : 'Paste bank export'}
              </button>
              {pasteOpen && (
                <>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={5}
                    spellCheck={false}
                    placeholder={'Paste here'}
                    className="w-full bg-bg-raised border border-border rounded px-3 py-2 text-xs font-mono outline-none focus:border-accent resize-y whitespace-pre"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      className="btn btn-primary text-xs"
                      onClick={handleImport}
                      disabled={!pasteText.trim()}
                    >
                      Import
                    </button>
                    <button
                      className="btn text-xs"
                      onClick={() => { setPasteText(''); setImportMsg(''); }}
                    >
                      Clear
                    </button>
                  </div>
                  {importMsg && <span className="text-xs text-text-dim">{importMsg}</span>}
                  <p className="text-[11px] text-text-faint leading-snug">
                    Paste a bank export (e.g. a RuneLite bank plugin). Each line starts with the
                    item id; non-wearable items are ignored. Adds to your owned list.
                  </p>
                </>
              )}
            </div>

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
                      title={`Remove ${p.name}${p.version ? ` (${p.version})` : ''}`}
                      aria-label={`Remove ${p.name}${p.version ? ` (${p.version})` : ''} from owned items`}
                      className="text-xs px-2 py-1 rounded bg-bg-raised border border-border hover:border-accent hover:text-accent flex items-center gap-1.5"
                    >
                      <GearIcon piece={p} size="xs" />
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
