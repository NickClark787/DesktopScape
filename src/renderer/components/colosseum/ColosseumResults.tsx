/**
 * Post-attempt results: outcome, DPS vs theoretical, damage by source,
 * dodge/parry rates, supplies, and the tick-by-tick mistakes timeline.
 */
import { Fragment } from 'react';
import type { ResultsSummary } from '@sim/solHeredit/types';
import { CONSUMABLE_INDEX } from '@sim/solHeredit/constants';

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

export function ColosseumResults({ results, visualAids = [] }: {
  results: ResultsSummary;
  /** Render-side readability aids that were on. Not engine assists, but
   *  still listed so a "clean" attempt is honestly clean. */
  visualAids?: string[];
}) {
  const r = results;
  const outcomeText = r.outcome === 'kill' ? 'Sol Heredit defeated!'
    : r.outcome === 'death' ? 'You died'
    : r.outcome === 'timeout' ? 'Time expired' : 'Run aborted';
  const outcomeColor = r.outcome === 'kill' ? 'text-osrs-green' : r.outcome === 'death' ? 'text-osrs-red' : 'text-text-dim';

  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Results</span>
        <span className="flex items-center gap-2">
          {r.assistsUsed && (
            <span className="panel-heading-meta text-accent" title="One or more assists were enabled during this run">
              assists on
            </span>
          )}
          {visualAids.length > 0 && (
            <span className="panel-heading-meta" title={`Visual aids on: ${visualAids.join(', ')}`}>
              {visualAids.length} visual aid{visualAids.length > 1 ? 's' : ''}
            </span>
          )}
        </span>
      </div>
      <div className="p-4 flex flex-col gap-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span className={`font-semibold ${outcomeColor}`}>{outcomeText}</span>
          <span className="tabular-nums text-text-dim">
            {r.seconds.toFixed(1)}s · {r.ticks} ticks
            {r.bossHpLeft > 0 && ` · boss ${r.bossHpLeft} HP left`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs tabular-nums">
          <span className="text-text-dim">DPS</span>
          <span className="text-right">{r.playerDps.toFixed(2)} / {r.theoreticalDps.toFixed(2)} theoretical ({pct(r.playerDps, r.theoreticalDps)})</span>
          <span className="text-text-dim">Triple parry</span>
          <span className="text-right">{r.tripleParry.blocked}/{r.tripleParry.total} blocked ({pct(r.tripleParry.blocked, r.tripleParry.total)})</span>
          <span className="text-text-dim">Grapple parry</span>
          <span className="text-right">
            {r.grapple.parried}/{r.grapple.total} ({pct(r.grapple.parried, r.grapple.total)}) · perfect {r.grapple.perfect}
          </span>
          {(['spear1', 'spear2', 'shield1', 'shield2'] as const).map((a) => (
            r.dodges[a].total > 0 ? (
              <Fragment key={a}>
                <span className="text-text-dim">Dodge {a}</span>
                <span className="text-right">{r.dodges[a].dodged}/{r.dodges[a].total} ({pct(r.dodges[a].dodged, r.dodges[a].total)})</span>
              </Fragment>
            ) : null
          ))}
        </div>

        {Object.keys(r.damageBySource).length > 0 && (
          <div className="border-t border-border pt-2">
            <div className="text-xs text-text-faint mb-1">Damage taken by source</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs tabular-nums">
              {Object.entries(r.damageBySource).sort((a, b) => b[1] - a[1]).map(([src, amt]) => (
                <div key={src} className="contents">
                  <span className="text-text-dim">{src}</span>
                  <span className="text-right text-osrs-red">{amt}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.keys(r.suppliesUsed).length > 0 && (
          <div className="border-t border-border pt-2">
            <div className="text-xs text-text-faint mb-1">Supplies used</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(r.suppliesUsed).map(([id, n]) => (
                <span key={id} className="px-2 py-0.5 rounded bg-bg-raised border border-border">
                  {CONSUMABLE_INDEX.get(id)?.name ?? id} ×{n}
                </span>
              ))}
            </div>
          </div>
        )}

        {r.mistakes.length > 0 && (
          <div className="border-t border-border pt-2">
            <div className="text-xs text-text-faint mb-1">Mistakes ({r.mistakes.length})</div>
            <div className="flex flex-col gap-1 max-h-56 overflow-auto pr-1">
              {r.mistakes.map((m, i) => (
                <div key={i} className="text-xs rounded border border-border bg-bg-raised px-2 py-1">
                  <span className="text-accent tabular-nums">t{m.tick}</span>{' '}
                  <span className="text-osrs-red">{m.what}.</span>{' '}
                  <span className="text-text-dim">Correct: {m.correctAction}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
