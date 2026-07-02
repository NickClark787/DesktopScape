/**
 * OSRS interface theme — the single source of truth for design tokens.
 *
 * Surfaces are weathered stone on a near-black backdrop, framed in bronze and
 * carved gold, with parchment reserved for "scroll" moments (panel heading
 * strips, the results readout, item tooltips). Vibrant colors are semantic
 * and sparing: OSRS item-yellow, XP green, rune-blue / fire-red / prayer-cyan.
 *
 * Token groups:
 *   bg.*        dark stone surfaces (backdrop → panel → raised → socket)
 *   parchment.* light scroll surfaces + their ink text colors
 *   border.*    bronze/gold frame lines
 *   accent.*    interactive gold (carved for frames, bright for hover/CTA)
 *   osrs.*      vibrant semantic highlights (use deliberately, not broadly)
 *   style.*     canonical combat-style hues (melee/ranged/magic)
 *   boxShadow   pre-baked bevels & glows — static; animate only their
 *               *opacity* via pseudo-elements, never the shadow itself
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        // Body stays a clean system sans; `display` is carved-stone Cinzel
        // for headings/wordmark; `pixel` is Pixelify Sans for tiny retro
        // chrome (badges, slot labels, XP drops) — never paragraphs.
        // Trebuchet MS (the actual 2007 client face) is the shared fallback.
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        rs: ['"RuneScape"', '"Trebuchet MS"', 'sans-serif'],
        display: ['"Cinzel"', '"Trebuchet MS"', 'Georgia', 'serif'],
        pixel: ['"Pixelify Sans"', '"Trebuchet MS"', 'monospace'],
      },
      colors: {
        // Dark stone surfaces, darkest (page) to lightest (raised controls),
        // plus the near-black equipment socket.
        bg: {
          DEFAULT: '#1c1a17',
          soft: '#3e3529',
          raised: '#4b4032',
          slot: '#14100c',
        },
        // Parchment "scroll" surfaces + ink text for on-parchment content.
        parchment: {
          DEFAULT: '#e8dcc0',
          deep: '#c9b587',
          ink: '#2b2419',
          'ink-dim': '#5c4e38',
        },
        // Bronze frame lines; `gilt` is the carved-gold rule.
        border: {
          DEFAULT: '#6b5838',
          strong: '#8c6f3f',
          gilt: '#d4af37',
        },
        // Parchment-tinted text on dark stone.
        text: {
          DEFAULT: '#f4ead1',
          dim: '#c9b894',
          faint: '#8f7f5f',
        },
        // Interactive gold. `carved` for frames/rests, DEFAULT for text and
        // affordances, `hover`/`bright` for the lit state and the CTA.
        accent: {
          carved: '#d4af37',
          DEFAULT: '#f2c94c',
          hover: '#ffd700',
        },
        // Vibrant semantic highlights — the OSRS chat/interface colors.
        osrs: {
          yellow: '#ffff00',
          green: '#3fbf5f',
          greenBright: '#00ff00',
          cyan: '#6fd6d6',
          purple: '#9b5de5',
        },
        // Combat styles keep their in-game hues: fire-red melee, XP-green
        // ranged, rune-blue magic.
        style: {
          melee: '#e2402a',
          ranged: '#3fbf5f',
          magic: '#4a90e2',
        },
      },
      // Sharper corners — carved stone, not rounded plastic.
      borderRadius: {
        DEFAULT: '3px',
        md: '4px',
        lg: '6px',
      },
      boxShadow: {
        // Carved 3D bevel: light top/left edge, dark bottom/right, soft drop.
        bevel: 'inset 1px 1px 0 rgba(244,234,209,0.09), inset -1px -1px 0 rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.5)',
        // Pressed/inset variant for sockets and inputs.
        'bevel-inset': 'inset 2px 2px 6px rgba(0,0,0,0.75), inset -1px -1px 0 rgba(244,234,209,0.06)',
        // Equipment socket — deep recessed well.
        slot: 'inset 0 3px 8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(107,88,56,0.45)',
        // Panel frame: bevel + a whisper of gilt on the top edge.
        panel: 'inset 0 1px 0 rgba(212,175,55,0.08), inset 1px 0 0 rgba(244,234,209,0.04), inset -1px -1px 0 rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.55)',
        // Raised-metal button.
        btn: 'inset 1px 1px 0 rgba(244,234,209,0.10), inset -1px -1px 0 rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.5)',
        // Gold halo — STATIC; toggled via pseudo-element opacity, never
        // transitioned directly (perf guardrail).
        glow: '0 0 0 1px rgba(212,175,55,0.55), 0 4px 16px rgba(212,175,55,0.22)',
      },
      keyframes: {
        'fade-rise': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.82)' },
          '62%': { opacity: '1', transform: 'scale(1.05)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'modal-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.975)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'backdrop-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '0.85' },
        },
        // XP-drop: float up and fade, like the in-game counter. Transform +
        // opacity only.
        'xp-drop': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '15%': { opacity: '1' },
          '100%': { opacity: '0', transform: 'translateY(-30px)' },
        },
        // One-shot gold shimmer sweep for the "new best setup" flourish —
        // a pre-painted gradient band moved with transform only.
        'shimmer-sweep': {
          '0%': { transform: 'translateX(-130%) skewX(-12deg)' },
          '100%': { transform: 'translateX(400%) skewX(-12deg)' },
        },
        // Idle orb bob — very slow, very low amplitude.
        'orb-bob': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' },
        },
      },
      animation: {
        'fade-rise': 'fade-rise 0.5s cubic-bezier(0.22,0.7,0.2,1) both',
        'pop-in': 'pop-in 0.32s cubic-bezier(0.2,0.8,0.2,1) both',
        'modal-in': 'modal-in 0.24s cubic-bezier(0.2,0.8,0.2,1) both',
        'backdrop-in': 'backdrop-in 0.2s ease-out both',
        'glow-pulse': 'glow-pulse 3.4s ease-in-out infinite',
        'xp-drop': 'xp-drop 0.95s ease-out both',
        'shimmer-sweep': 'shimmer-sweep 0.7s cubic-bezier(0.4,0,0.2,1) both',
        'orb-bob': 'orb-bob 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
