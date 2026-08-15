import { defineConfig } from 'tsup';
import { buildInfoDefines, readBuildInfo } from '../../scripts/build-info.mjs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  sourcemap: true,
  clean: true,
  define: buildInfoDefines(readBuildInfo(process.cwd())),
});
