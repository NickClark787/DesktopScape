/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        rs: ['"RuneScape"', '"Trebuchet MS"', 'sans-serif'],
      },
      colors: {
        bg: {
          DEFAULT: '#0e1116',
          soft: '#151a21',
          raised: '#1c232c',
          slot: '#2a3340',
        },
        border: {
          DEFAULT: '#2b3240',
          strong: '#3a4453',
        },
        text: {
          DEFAULT: '#e6edf3',
          dim: '#9aa4b2',
          faint: '#5e6773',
        },
        accent: {
          DEFAULT: '#ffb11a',
          hover: '#ffc247',
        },
        style: {
          melee: '#d04040',
          ranged: '#4aab5a',
          magic: '#4285c7',
        },
      },
      boxShadow: {
        slot: 'inset 0 0 0 1px rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
};
