import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Reads the build stamp that gets baked into a bundle at build time.
 *
 * `packageDir` is the directory holding the package.json to take the version
 * from — callers pass `process.cwd()`, which pnpm sets to the package root for
 * every workspace script.
 */
export function readBuildInfo(packageDir) {
  const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  return { version: pkg.version, commit: gitCommit(), buildTime: new Date().toISOString() };
}

/**
 * Maps a build stamp to the esbuild/vite `define` entries the `build-info.ts`
 * modules expect. Values are JSON-encoded because `define` substitutes raw
 * source text, not values.
 */
export function buildInfoDefines(info) {
  return {
    __APP_VERSION__: JSON.stringify(info.version),
    __GIT_COMMIT__: JSON.stringify(info.commit),
    __BUILD_TIME__: JSON.stringify(info.buildTime),
  };
}

// Docker's build context has no .git, so the SHA is best-effort. The self-host
// deploy builds in a detached-HEAD checkout, which rev-parse handles fine.
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}
