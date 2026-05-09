import type { CombatStyle } from '@shared/types';
import { DEFAULT_STYLE_ORDER } from '../utils/styleRanking';

interface Props {
  value: CombatStyle;
  onChange: (s: CombatStyle) => void;
  /**
   * Display order, best-to-worst. When omitted the tabs render in the
   * canonical melee/ranged/magic order. App computes this from the
   * selected monster (defence heuristic pre-run, actual DPS post-run)
   * so the actual best style sits leftmost.
   */
  order?: ReadonlyArray<CombatStyle>;
  /**
   * Optional title shown on hover of the leading tab to explain *why* it
   * leads. Helps users distinguish "you reordered the tabs on me" from
   * "this is broken".
   */
  leaderHint?: string;
  /**
   * Per-style DPS to display under each tab label. Populated once the
   * user has run Find best setup — gives an at-a-glance comparison of
   * the three styles' actual peak DPS without flipping tabs.
   */
  dpsByStyle?: Partial<Record<CombatStyle, number>>;
}

const TAB_META: Record<CombatStyle, { label: string; accent: string }> = {
  melee: { label: 'Melee', accent: 'text-style-melee' },
  ranged: { label: 'Ranged', accent: 'text-style-ranged' },
  magic: { label: 'Magic', accent: 'text-style-magic' },
};

export function StyleTabs({ value, onChange, order = DEFAULT_STYLE_ORDER, leaderHint, dpsByStyle }: Props) {
  return (
    <div className="inline-flex gap-1 bg-bg-soft border border-border rounded-lg p-1">
      {order.map((id, i) => {
        const meta = TAB_META[id];
        const isLeader = i === 0;
        const dps = dpsByStyle?.[id];
        return (
          <button
            key={id}
            className="pill-tab flex flex-col items-center gap-0.5 leading-tight"
            data-active={value === id}
            onClick={() => onChange(id)}
            title={isLeader ? leaderHint : undefined}
          >
            <span className="flex items-center">
              <span className={value === id ? meta.accent : ''}>{meta.label}</span>
              {/* Gold dot on the leading tab telegraphs "this style is
                  best for the selected monster" — driven by either the
                  defence heuristic (pre-run) or actual DPS (post-run). */}
              {isLeader && leaderHint && (
                <span
                  className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent align-middle"
                  aria-hidden
                />
              )}
            </span>
            {dps !== undefined && (
              <span className="text-[10px] tabular-nums text-text-faint font-normal">
                {dps.toFixed(2)} dps
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
