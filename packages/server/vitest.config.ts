import { defineConfig } from 'vitest/config';
import { buildInfoDefines, readBuildInfo } from '../../scripts/build-info.mjs';

export default defineConfig({
  // Mirrors tsup.config.ts — vitest never runs tsup, so without this the tests
  // would exercise the dev fallback in src/build-info.ts instead of the real
  // injected values.
  define: buildInfoDefines(readBuildInfo(process.cwd())),
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: ':memory:',
      JWT_SECRET: 'test-secret-not-used-in-production',
      // Fixtures across the suite create games on fixed windows like
      // 2020 → 2099. Tests of the bounds pass strict values explicitly.
      GAME_MAX_DURATION_DAYS: '100000',
      GAME_MAX_START_DELAY_DAYS: '100000',
    },
  },
});
