import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Vitest config — runs the engine unit tests under `tests/`. Path aliases
 * mirror tsconfig.web.json so imports look identical to the rest of the
 * codebase. Engine-only — no React/DOM here, so we use the default node env.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@engine': resolve(__dirname, 'src/engine'),
      '@sim': resolve(__dirname, 'src/sim'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@data': resolve(__dirname, 'resources/data'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
