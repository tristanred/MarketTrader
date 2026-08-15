/**
 * Response body for GET /version. Describes the build a process is actually
 * running, which is not necessarily the current state of the repository —
 * every field is captured at build time, not read live.
 */
export interface VersionInfo {
  /** Semver of the build. `0.0.0-dev` when running under tsx, which has no build step. */
  version: string;
  /** Short git SHA the build came from. `dev` under tsx; `unknown` where .git was absent, as in a Docker build. */
  commit: string;
  /** ISO 8601 timestamp of when the bundle was built. */
  buildTime: string;
}
