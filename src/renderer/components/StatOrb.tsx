/**
 * OSRS-style stat orb — the HP/prayer/run-energy globe motif repurposed for a
 * summary stat. A dark socket disc inside a bronze ring, with a colored arc
 * showing the stat's fill (accuracy %, TTK progress, …) and the value in the
 * center.
 *
 * Static SVG: the arc length is computed per render and snaps on change (the
 * accompanying XP-drop signals the change; nothing here animates in a loop
 * except an optional, very slow transform-only bob on the whole orb).
 */

interface Props {
  /** Small caption under the orb (e.g. "Accuracy"). */
  label: string;
  /** Center readout (pre-formatted, keep it ≤5 chars: "74%", "48s"). */
  display: string;
  /** Arc fill fraction 0..1. */
  frac: number;
  /** Arc + ring accent color (CSS color). */
  color: string;
  /** Native tooltip with the precise value. */
  title?: string;
  /** Enable the slow idle bob (use on at most one or two orbs). */
  bob?: boolean;
}

const R = 26;
const CIRC = 2 * Math.PI * R;

export function StatOrb({ label, display, frac, color, title, bob }: Props) {
  const clamped = Math.max(0, Math.min(1, isFinite(frac) ? frac : 0));
  return (
    <div
      className={['flex flex-col items-center justify-center gap-1 select-none', bob ? 'animate-orb-bob' : ''].join(' ')}
      title={title}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${label}: ${display}`}>
        {/* socket disc */}
        <circle cx="32" cy="32" r={R} fill="var(--c-socket)" />
        {/* recessed track */}
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="6" />
        {/* colored fill arc, from 12 o'clock */}
        <circle
          cx="32" cy="32" r={R} fill="none"
          stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(CIRC * clamped).toFixed(1)} ${CIRC.toFixed(1)}`}
          transform="rotate(-90 32 32)"
          opacity="0.9"
        />
        {/* bronze bezel + inner gilt line */}
        <circle cx="32" cy="32" r="30" fill="none" stroke="var(--c-bronze-strong)" strokeWidth="2.5" />
        <circle cx="32" cy="32" r="28.5" fill="none" stroke="var(--c-gold-carved)" strokeWidth="0.75" opacity="0.55" />
        <text
          x="32" y="36" textAnchor="middle"
          fill="var(--c-text)" fontSize="13" fontWeight="700"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {display}
        </text>
      </svg>
      <span className="font-pixel text-[10px] uppercase tracking-wide text-text-faint">{label}</span>
    </div>
  );
}
