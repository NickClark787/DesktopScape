import type { CombatStyle } from '@shared/types';
import { DEFAULT_STYLE_ORDER } from '../utils/styleRanking';

interface Props {
  value: CombatStyle;
  onChange: (s: CombatStyle) => void;
  /**
   * Display order, best-to-worst. When omitted the tabs render in the
   * canonical melee/ranged/magic order. App computes this from the selected
   * monster via `rankStyles` so the most-likely-best style sits leftmost.
   */
  order?: ReadonlyArray<CombatStyle>;
  /**
   * Optional title shown on hover of the leading tab to explain *why* it
   * leads (e.g. "Best vs Aberrant spectre — lowest magic defence"). Helps
   * users distinguish "you reordered the tabs on me" from "this is broken".
   */
  leaderHint?: string;
}

const TAB_META: Record<CombatStyle, { label: string; accent: string }> = {
  melee: { label: 'Melee', accent: 'text-style-melee' },
  ranged: { label: 'Ranged', accent: 'text-style-ranged' },
  magic: { label: 'Magic', accent: 'text-style-magic' },
};

export function StyleTabs({ value, onChange, order = DEFAULT_STYLE_ORDER, leaderHint }: Props) {
  return (
    <div className="inline-flex gap-1 bg-bg-soft border border-border rounded-lg p-1">
      {order.map((id, i) => {
        const meta = TAB_META[id];
        const isLeader = i === 0;
        return (
          <button
            key={id}
            className="pill-tab"
            data-active={value === id}
            onClick={() => onChange(id)}
            title={isLeader ? leaderHint : undefined}
          >
            <span className={value === id ? meta.accent : ''}>{meta.label}</span>
            {/* Tiny dot on the leading tab to advertise "this is the
                recommended style for the selected monster". Stays out of
                the way when no monster is picked (no leaderHint → no dot). */}
            {isLeader && leaderHint && (
              <span
                className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent align-middle"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
