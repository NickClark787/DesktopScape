import { useMemo, useState } from 'react';
import fuzzysort from 'fuzzysort';
import type { EquipmentPiece } from '@shared/types';
import { GearIcon } from './GearIcon';
import { formatGp, parseGp } from '../utils/gp';

interface Props {
  equipment: EquipmentPiece[];
  /** Blacklisted items the optimizer/picker must never suggest. */
  excludedIds: Set<number>;
  onAddExcluded: (id: number) => void;
  onRemoveExcluded: (id: number) => void;
  onClearExcluded: () => void;
  /** Budget cap (gp) for Find best setup; null = unconstrained. */
  budget: number | null;
  onBudgetChange: (v: number | null) => void;
  /** Budget needs GE prices — fetched lazily when a budget is first set. */
  pricesLoaded: boolean;
  loadingPrices: boolean;
  onFetchPrices: () => Promise<void>;
}

/**
 * Search constraints for "Find best setup": a gp budget (owned items count as
 * free; untradeables you don't own are unbuyable) and an avoid-list of items
 * the optimizer must never suggest.
 */
export function ConstraintsPanel({
  equipment, excludedIds, onAddExcluded, onRemoveExcluded, onClearExcluded,
  budget, onBudgetChange, pricesLoaded, loadingPrices, onFetchPrices,
}: Props) {
  const [budgetText, setBudgetText] = useState(() => (budget != null ? formatGp(budget) : ''));
  const [budgetError, setBudgetError] = useState('');
  const [query, setQuery] = useState('');

  const excludedPieces = useMemo(
    () => equipment.filter((p) => excludedIds.has(p.id)),
    [equipment, excludedIds],
  );

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const candidates = equipment.filter((p) => !excludedIds.has(p.id));
    const hits = fuzzysort.go(query, candidates, { keys: ['name', 'version'], limit: 20, threshold: -10000 });
    return hits.map((h) => h.obj);
  }, [equipment, excludedIds, query]);

  function commitBudget(text: string) {
    const t = text.trim();
    if (!t) {
      setBudgetError('');
      onBudgetChange(null);
      return;
    }
    const gp = parseGp(t);
    if (gp == null) {
      setBudgetError('Use a number like 100m, 1.5b, 250k.');
      return;
    }
    setBudgetError('');
    onBudgetChange(gp);
    setBudgetText(formatGp(gp));
    // Budget mode is priced in GE gold — pull prices the first time it's used.
    if (!pricesLoaded && !loadingPrices) void onFetchPrices().catch(() => {});
  }

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Search constraints</span>
        {(budget != null || excludedIds.size > 0) && (
          <span className="panel-heading-meta">
            {[budget != null ? `≤ ${formatGp(budget)}` : null, excludedIds.size ? `${excludedIds.size} avoided` : null]
              .filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-3">
        {/* Budget */}
        <div className="flex flex-col gap-1">
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-text-dim">Budget (gp)</span>
            <input
              type="text"
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={(e) => commitBudget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitBudget((e.target as HTMLInputElement).value); }}
              placeholder="none"
              className="num-input w-24"
            />
          </label>
          {budgetError && <span className="text-xs text-style-melee">{budgetError}</span>}
          {budget != null && (
            <span className="text-[11px] text-text-faint leading-snug">
              Best setup will cost at most {formatGp(budget)}. Owned items are free; untradeables
              you don't own are skipped.
              {loadingPrices ? ' Fetching GE prices…' : !pricesLoaded ? (
                <> Needs prices — <button className="underline-offset-2 underline hover:text-accent" onClick={() => void onFetchPrices().catch(() => {})}>load GE prices</button>.</>
              ) : null}
            </span>
          )}
        </div>

        {/* Avoid list */}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Avoid an item… (never suggest it)"
            className="w-full bg-bg-raised border border-border rounded px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {results.length > 0 && (
            <div className="max-h-40 overflow-auto rounded border border-border">
              {results.map((p) => (
                <button
                  key={`${p.id}-${p.version}`}
                  onClick={() => { onAddExcluded(p.id); setQuery(''); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-bg-raised"
                >
                  <span className="text-style-melee">−</span>
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
          {excludedPieces.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-text-faint">
                <span>Avoided ({excludedPieces.length})</span>
                <button onClick={onClearExcluded} className="hover:text-accent">Clear all</button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                {excludedPieces.map((p) => (
                  <button
                    key={`${p.id}-${p.version}`}
                    onClick={() => onRemoveExcluded(p.id)}
                    title={`Stop avoiding ${p.name}`}
                    className="text-xs px-2 py-1 rounded bg-bg-raised border border-border hover:border-accent hover:text-accent flex items-center gap-1.5"
                  >
                    <GearIcon piece={p} size="xs" />
                    <span className="line-through decoration-style-melee/60">{p.name}</span>
                    <span className="text-text-faint">×</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
