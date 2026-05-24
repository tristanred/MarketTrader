import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import {
  recordSnapshotsForActiveGames,
  compactEndedGames,
} from '../services/portfolio-snapshot.js';
import { env } from '../env.js';

/**
 * One tick of the portfolio-snapshot worker:
 *   1. Capture a snapshot row per player per active game.
 *   2. Compact ended games whose snapshots haven't yet been reduced
 *      to one-per-player-per-day.
 *
 * Both steps swallow their own errors at the service layer so a bad game
 * does not block the rest. The tick itself rethrows only on programmer
 * errors (e.g. db handle gone) — the outer setInterval guards re-entrancy.
 */
export async function runPortfolioSnapshotTick(deps: { db: Db; bus?: EventBus }): Promise<void> {
  const { db, bus } = deps;
  await recordSnapshotsForActiveGames(db, bus);
  await compactEndedGames(db);
}

/**
 * Starts the portfolio-snapshot loop. Mirrors the re-entrancy guard used by
 * {@link startPendingOrdersWorker}: if a previous tick is still in flight
 * when the next interval fires, the new tick is skipped.
 */
export function startPortfolioSnapshotWorker(deps: {
  db: Db;
  bus?: EventBus;
  logger?: FastifyBaseLogger;
  intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = deps.intervalMs ?? env.PORTFOLIO_SNAPSHOT_INTERVAL_MS;
  let running = false;
  const handle = setInterval(() => {
    if (running) return;
    running = true;
    runPortfolioSnapshotTick(deps)
      .catch((err) => {
        deps.logger?.error({ err }, 'portfolio-snapshot tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return {
    stop: () => clearInterval(handle),
  };
}
