import { and, eq, gte, lte } from 'drizzle-orm';
import type {
  LeaderboardHistoryPoint,
  LeaderboardHistoryRange,
  LeaderboardHistoryResponse,
  LeaderboardHistorySeries,
} from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

const RANGE_TO_MS: Record<Exclude<LeaderboardHistoryRange, 'all'>, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '5d': 5 * 24 * 60 * 60 * 1000,
  '10d': 10 * 24 * 60 * 60 * 1000,
};

const DEFAULT_MAX_POINTS = 240;

/**
 * Resolves the (startedAt, endedAt) window for a request. `all` clamps to
 * the game's startDate; finite ranges anchor on `endedAt` (game end if the
 * game has ended, otherwise "now").
 */
function resolveWindow(
  range: LeaderboardHistoryRange,
  game: { startDate: string; endDate: string; status: string },
): { startedAt: string; endedAt: string } {
  const now = new Date();
  const endedAt = game.status === 'ended'
    ? game.endDate
    : now.toISOString();
  if (range === 'all') {
    return { startedAt: game.startDate, endedAt };
  }
  const endMs = new Date(endedAt).getTime();
  const startMs = endMs - RANGE_TO_MS[range];
  const gameStartMs = new Date(game.startDate).getTime();
  const clampedStart = new Date(Math.max(startMs, gameStartMs)).toISOString();
  return { startedAt: clampedStart, endedAt };
}

/**
 * Largest-Triangle-Three-Buckets downsampling. Reduces a series of `n` points
 * to `targetPoints` while preserving visual peaks/troughs. Pure function — no
 * I/O. Algorithm: divide the middle of the series into `targetPoints - 2`
 * equal buckets, pick the point in each bucket forming the largest triangle
 * with the previous selected point and the next bucket's centroid. Endpoints
 * always survive.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation" (2013).
 */
export function lttb(
  points: readonly LeaderboardHistoryPoint[],
  targetPoints: number,
): LeaderboardHistoryPoint[] {
  if (targetPoints >= points.length || targetPoints < 3) {
    return points.slice();
  }
  const sampled: LeaderboardHistoryPoint[] = [];
  // Bucket size for the middle section.
  const bucketSize = (points.length - 2) / (targetPoints - 2);

  // Always include the first point.
  const firstPoint = points[0];
  if (!firstPoint) return [];
  sampled.push(firstPoint);

  let a = 0; // index of the previously selected point

  for (let i = 0; i < targetPoints - 2; i++) {
    // Centroid of the next bucket
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, points.length);
    let avgX = 0;
    let avgY = 0;
    const nextSize = Math.max(nextEnd - nextStart, 1);
    for (let j = nextStart; j < nextEnd; j++) {
      const p = points[j];
      if (!p) continue;
      avgX += new Date(p.t).getTime();
      avgY += p.v;
    }
    avgX /= nextSize;
    avgY /= nextSize;

    // Current bucket range
    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;
    const pointA = points[a];
    if (!pointA) continue;
    const ax = new Date(pointA.t).getTime();
    const ay = pointA.v;

    let maxArea = -1;
    let maxAreaIndex = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const p = points[j];
      if (!p) continue;
      const px = new Date(p.t).getTime();
      const area = Math.abs(
        (ax - avgX) * (p.v - ay) - (ax - px) * (avgY - ay),
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }
    const chosen = points[maxAreaIndex];
    if (chosen) {
      sampled.push(chosen);
      a = maxAreaIndex;
    }
  }

  // Always include the last point.
  const lastPoint = points[points.length - 1];
  if (lastPoint) sampled.push(lastPoint);
  return sampled;
}

export interface LeaderboardHistoryOptions {
  range: LeaderboardHistoryRange;
  /** Max points per series after downsampling. Default 240. */
  maxPoints?: number;
}

/**
 * Reads portfolio snapshots for a game over the requested range, groups by
 * player, and LTTB-downsamples each series to `maxPoints` (default 240).
 * Returns players who have no snapshots in range with `points: []` so the
 * client always has the full roster.
 */
export async function getLeaderboardHistory(
  db: Db,
  gameId: string,
  options: LeaderboardHistoryOptions,
): Promise<LeaderboardHistoryResponse> {
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;

  const [game] = await db
    .select({
      startDate: schema.games.startDate,
      endDate: schema.games.endDate,
      status: schema.games.status,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);

  // Caller is responsible for surfacing 404; this function trusts that the
  // membership check has already happened in the route layer.
  if (!game) {
    return { range: options.range, startedAt: '', endedAt: '', series: [] };
  }

  const { startedAt, endedAt } = resolveWindow(options.range, game);

  // Fetch every (player, snapshot) tuple for the game in one query.
  // `gamePlayers ↔ users` join gives us the username + stable playerId
  // (userId) the client expects.
  const rows = await db
    .select({
      playerId: schema.gamePlayers.userId,
      username: schema.users.username,
      t: schema.portfolioSnapshots.capturedAt,
      v: schema.portfolioSnapshots.totalValue,
      r: schema.portfolioSnapshots.rank,
    })
    .from(schema.portfolioSnapshots)
    .innerJoin(
      schema.gamePlayers,
      eq(schema.portfolioSnapshots.gamePlayerId, schema.gamePlayers.id),
    )
    .innerJoin(schema.users, eq(schema.gamePlayers.userId, schema.users.id))
    .where(
      and(
        eq(schema.portfolioSnapshots.gameId, gameId),
        gte(schema.portfolioSnapshots.capturedAt, startedAt),
        lte(schema.portfolioSnapshots.capturedAt, endedAt),
      ),
    );

  // The roster — every player in the game — so the response includes
  // players with zero snapshots in range as empty series.
  const roster = await db
    .select({
      playerId: schema.gamePlayers.userId,
      username: schema.users.username,
    })
    .from(schema.gamePlayers)
    .innerJoin(schema.users, eq(schema.gamePlayers.userId, schema.users.id))
    .where(eq(schema.gamePlayers.gameId, gameId));

  const byPlayer = new Map<string, { username: string; points: LeaderboardHistoryPoint[] }>();
  for (const r of roster) {
    byPlayer.set(r.playerId, { username: r.username, points: [] });
  }
  for (const row of rows) {
    const entry = byPlayer.get(row.playerId);
    if (!entry) continue; // Player has snapshots but isn't on the roster — shouldn't happen.
    entry.points.push({ t: row.t, v: Number(row.v), r: row.r });
  }

  const series: LeaderboardHistorySeries[] = [];
  for (const [playerId, { username, points }] of byPlayer) {
    points.sort((a, b) => a.t.localeCompare(b.t));
    series.push({
      playerId,
      username,
      points: lttb(points, maxPoints),
    });
  }

  return { range: options.range, startedAt, endedAt, series };
}
