import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { ConfigReader } from '../config/runtime-config.js';
import { hourStartOf, type UsageTracker } from '../limits/usage-tracker.js';
import { flushUsage, pruneUsage } from '../limits/usage-store.js';
import { startIntervalWorker, type IntervalWorker } from './interval-worker.js';

const DAY_MS = 86_400_000;

/** Dependencies for {@link runUsageRollupTick} and {@link startUsageRollupWorker}. */
export interface UsageRollupDeps {
  db: Db;
  tracker: UsageTracker;
  config: ConfigReader;
  logger?: FastifyBaseLogger;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * One rollup tick: take the tracker's buffered counts, add them to the hourly
 * tables, then drop rows older than `USAGE_RETENTION_DAYS`. The buffer is
 * swapped before the write, so a failed write loses that interval's counts —
 * acceptable for monitoring data, and it keeps requests from ever waiting on it.
 */
export async function runUsageRollupTick(deps: UsageRollupDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const snapshot = deps.tracker.swap();
  if (snapshot.overflow.requests + snapshot.overflow.denials > 0) {
    deps.logger?.warn(
      { overflowRequests: snapshot.overflow.requests, overflowDenials: snapshot.overflow.denials },
      'usage tracker hit its key bound; excess counted under the *overflow* subject',
    );
  }
  await flushUsage(deps.db, snapshot);
  const retentionMs = deps.config.get('USAGE_RETENTION_DAYS') * DAY_MS;
  await pruneUsage(deps.db, hourStartOf(now.getTime() - retentionMs));
}

/** Starts the rollup loop at `USAGE_FLUSH_INTERVAL_MS`, re-read per wait so an admin override applies. */
export function startUsageRollupWorker(
  deps: UsageRollupDeps & { intervalMs?: number },
): IntervalWorker {
  return startIntervalWorker(
    'usage-rollup',
    () => runUsageRollupTick(deps),
    deps.intervalMs ?? (() => deps.config.get('USAGE_FLUSH_INTERVAL_MS')),
    (err) => deps.logger?.error({ err }, 'usage rollup tick failed'),
  );
}
