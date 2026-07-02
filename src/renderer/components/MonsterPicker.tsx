import { useMemo, useState } from 'react';
import fuzzysort from 'fuzzysort';
import type { Monster } from '@shared/types';
import { MonsterIcon } from './MonsterIcon';

interface Props {
  monsters: Monster[];
  /** The resolved selected monster (id + version aware) — App owns resolution
   *  so variants that share a game id highlight and compute correctly. */
  selected: Monster | null;
  onSelect: (id: number, version: string | null) => void;
}

export function MonsterPicker({ monsters, selected, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query.trim()) return monsters.slice(0, 40);
    const hits = fuzzysort.go(query, monsters, {
      keys: ['name', 'version'],
      limit: 40,
      threshold: -10000,
    });
    return hits.map((h) => h.obj);
  }, [monsters, query]);

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {selected && <MonsterIcon monster={selected} size="xs" />}
          <span>Encounter</span>
        </span>
        {selected && <span className="panel-heading-meta truncate">Lvl {selected.level} · {selected.skills.hp} HP</span>}
      </div>
      <div className="p-3">
        <input
          type="text"
          placeholder="Search for a monster or boss..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-bg-raised border border-border rounded px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="mt-3 max-h-72 overflow-auto rounded border border-border">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-text-faint">No matches</div>
          )}
          {results.map((m) => {
            // Object identity: `selected` comes from the same monsters array,
            // so this distinguishes same-id variants exactly.
            const active = m === selected;
            return (
              <button
                key={`${m.id}-${m.version}`}
                onClick={() => onSelect(m.id, m.version ?? null)}
                className={[
                  'w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition',
                  active ? 'bg-accent/10 text-accent' : 'hover:bg-bg-raised text-text',
                ].join(' ')}
              >
                <MonsterIcon monster={m} size="sm" />
                <span className="flex-1 truncate">
                  {m.name}
                  {m.version && <span className="text-text-faint"> · {m.version}</span>}
                </span>
                <span className="text-text-faint text-xs">Lv {m.level}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
