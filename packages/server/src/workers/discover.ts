import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { pruneDiscover, refreshGamePicks, refreshMarketMovers } from '../services/discover.js';
import { env } from '../env.js';
import { startIntervalWorker, type IntervalWorker } from './interval-worker.js';

/** Dependencies for {@link runDiscoverTick} and {@link startDiscoverWorker}. */
export interface DiscoverWorkerDeps {
  db: Db;
  provider: StockProvider;
  logger?: FastifyBaseLogger;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * One tick of the Discover worker: capture missing market-mover lists (only
 * outside a regular session), generate daily picks for games without one, then
 * prune old rows. Per-list and per-game failures are logged and left for the
 * next tick; this is the only place Discover data is produced, so request
 * handlers never wait on the provider.
 */
export async function runDiscoverTick(deps: DiscoverWorkerDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const onError = (err: unknown, context: string) =>
    deps.logger?.warn({ err, context }, 'discover refresh step failed');
  await refreshMarketMovers(deps.db, deps.provider, now, onError);
  await refreshGamePicks(deps.db, deps.provider, now, onError);
  await pruneDiscover(deps.db, now);
}

/**
 * Starts the Discover loop at `DISCOVER_REFRESH_INTERVAL_MS`, firing once at
 * start so a restart doesn't leave games on "preparing" for a full interval.
 */
export function startDiscoverWorker(
  deps: DiscoverWorkerDeps & { intervalMs?: number },
): IntervalWorker {
  return startIntervalWorker(
    'discover',
    () => runDiscoverTick(deps),
    deps.intervalMs ?? env.DISCOVER_REFRESH_INTERVAL_MS,
    (err) => deps.logger?.error({ err }, 'discover tick failed'),
    { immediate: true },
  );
}
