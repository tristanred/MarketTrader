import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { ConfigReader } from '../config/runtime-config.js';
import { toSqlTimestamp } from '../limits/quota-counts.js';
import { pruneAttemptsBefore } from '../services/stock-analysis/store.js';
import { startIntervalWorker, type IntervalWorker } from './interval-worker.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Dependencies for {@link runAnalysisPruneTick} and {@link startAnalysisPruneWorker}. */
export interface AnalysisPruneDeps {
  db: Db;
  config: ConfigReader;
  logger?: FastifyBaseLogger;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * Deletes stock-analysis rows past `ANALYSIS_RETENTION_DAYS`. The cutoff never
 * falls inside the cache TTL or the 24 h quota window, whatever the options say,
 * so a misconfiguration cannot delete a live cache entry or refund a quota.
 */
export async function runAnalysisPruneTick(deps: AnalysisPruneDeps): Promise<void> {
  const now = (deps.now?.() ?? new Date()).getTime();
  const keepMs = Math.max(
    deps.config.get('ANALYSIS_RETENTION_DAYS') * DAY_MS,
    deps.config.get('ANALYSIS_CACHE_TTL_MS'),
    DAY_MS,
  );
  await pruneAttemptsBefore(deps.db, toSqlTimestamp(new Date(now - keepMs)));
}

/** Starts the hourly prune loop; the first tick runs at start so a long-stopped server catches up. */
export function startAnalysisPruneWorker(
  deps: AnalysisPruneDeps & { intervalMs?: number },
): IntervalWorker {
  return startIntervalWorker(
    'stock-analysis-prune',
    () => runAnalysisPruneTick(deps),
    deps.intervalMs ?? HOUR_MS,
    (err) => deps.logger?.error({ err }, 'stock analysis prune tick failed'),
    { immediate: true },
  );
}
