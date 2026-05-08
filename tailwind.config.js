/**
 * Modern OSRS theme. The base is a dark stone-and-leather palette warmed
 * away from the previous cool blue-gray, with bronze borders and OSRS gold
 * (#ffcb47) as the accent. Panel headings adopt the in-game gilt-uppercase
 * treatment via index.css; item slots use a near-black recessed well that
 * mirrors the equipment-screen interface.
 *
 * Style colors (melee/ranged/magic) keep their canonical OSRS hues so the
 * style tabs and weapon-class badges still read at a glance.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        // Inter for general UI density; Trebuchet MS (the actual font the
        // RuneScape Java client used) as the "rs" family for the wordmark
        // and panel headings.
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        rs: ['"RuneScape"', '"Trebuchet MS"', 'sans-serif'],
      },
      colors: {
        // Warm leather/stone backgrounds — getting away from the prior
        // blue-gray that read as "any modern dark UI". The slot color is
        // pushed almost-black so equipment wells visibly recess into the
        // surrounding panel.
        bg: {
          DEFAULT: '#1a130d',
          soft: '#241a12',
          raised: '#2e2218',
          slot: '#0f0a06',
        },
        // Bronze borders — `strong` for hover/active, `gilt` for the thin
        // highlight rule under panel headings.
        border: {
          DEFAULT: '#4a3a26',
          strong: '#6b5538',
          gilt: '#8a6e3a',
        },
        // Parchment-tinted text. `text` is light enough for body copy
        // against the dark bg, dim/faint scale down for secondary info.
        text: {
          DEFAULT: '#f0e0c0',
          dim: '#b8a484',
          faint: '#7a6b50',
        },
        // OSRS gold. Slightly brighter than the previous orange to land on
        // the in-game yellow players associate with chat highlights and
        // skill levels.
        accent: {
          DEFAULT: '#ffcb47',
          hover: '#ffe080',
        },
        // Canonical OSRS combat-style colors. Lightly tweaked from before
        // to feel a touch more game-accurate; melee deeper red, magic less
        // Google-blue, ranged unchanged.
        style: {
          melee: '#d83a3a',
          ranged: '#3aa050',
          magic: '#5a8fce',
        },
      },
      boxShadow: {
        // Heavy inset on slot cells gives the recessed-well look from the
        // equipment-screen interface.
        slot: 'inset 0 2px 5px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(74,58,38,0.4)',
        // Subtle gilt highlight along the top edge + soft drop for depth.
        panel: 'inset 0 1px 0 rgba(255,203,71,0.05), 0 2px 8px rgba(0,0,0,0.45)',
        // Raised-metal button: 1px highlight up top, 1px shadow down low.
        btn: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.5)',
      },
    },
  },
  plugins: [],
};
