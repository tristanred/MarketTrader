import { and, count, eq, gt, gte, inArray, min, ne } from 'drizzle-orm';
import type { LimitKey } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { LIMIT_CATALOGUE } from './catalogue.js';
import { toIsoUtc } from './account.js';
import type { ResolvedLimit } from './resolver.js';
import { LimitExceededError } from './errors.js';

/** Anything that can run a select — the app `db` or an open transaction. */
export type Reader = Pick<Db, 'select'>;

/**
 * Formats `d` as `YYYY-MM-DD HH:MM:SS`, the form the timestamp defaults store. SQLite
 * compares textually, so an ISO `T` would skew every window. Postgres's zone-less column
 * matches only while the session `TimeZone` is UTC (docs/deployment.md).
 */
export function toSqlTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Start of `key`'s rolling window, as a value comparable with stored timestamps. */
export function windowStart(key: LimitKey, now: number = Date.now()): string {
  const windowMs = LIMIT_CATALOGUE[key].windowMs;
  if (windowMs == null) throw new Error(`limit ${key} has no window`);
  return toSqlTimestamp(new Date(now - windowMs));
}

/** Games `userId` created at or after `since` (a {@link toSqlTimestamp} value). */
export async function countGamesCreatedSince(
  db: Reader,
  userId: string,
  since: string,
): Promise<number> {
  const { games } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(games)
    .where(and(eq(games.createdBy, userId), gte(games.createdAt, since)));
  return Number(row?.n ?? 0);
}

/** ISO UTC time of `userId`'s oldest game created at or after `since` ({@link toSqlTimestamp} format); null when none. */
export async function oldestGameCreatedSince(
  db: Reader,
  userId: string,
  since: string,
): Promise<string | null> {
  const { games } = schema;
  const [row] = await db
    .select({ at: min(games.createdAt) })
    .from(games)
    .where(and(eq(games.createdBy, userId), gte(games.createdAt, since)));
  // ISO, because `secondsUntilWindowFrees` parses it and the stored SQLite
  // format would be read as local time.
  return row?.at ? toIsoUtc(row.at) : null;
}

/**
 * Games the user created that are still running. Stored `status` can lag
 * behind the clock (it is recomputed lazily), so a game past its `endDate`
 * is excluded by date as well as by status.
 */
export async function countActiveGamesOwned(
  db: Reader,
  userId: string,
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  const { games } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(games)
    .where(and(eq(games.createdBy, userId), ne(games.status, 'ended'), gt(games.endDate, nowIso)));
  return Number(row?.n ?? 0);
}

/** Seats `userId` took at or after `since` ({@link toSqlTimestamp} format), creator seats included. */
export async function countGamesJoinedSince(
  db: Reader,
  userId: string,
  since: string,
): Promise<number> {
  const { gamePlayers } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.userId, userId), gte(gamePlayers.joinedAt, since)));
  return Number(row?.n ?? 0);
}

/** ISO UTC time of `userId`'s oldest seat taken at or after `since` ({@link toSqlTimestamp} format); null when none. */
export async function oldestJoinSince(
  db: Reader,
  userId: string,
  since: string,
): Promise<string | null> {
  const { gamePlayers } = schema;
  const [row] = await db
    .select({ at: min(gamePlayers.joinedAt) })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.userId, userId), gte(gamePlayers.joinedAt, since)));
  // ISO, because `secondsUntilWindowFrees` parses it and the stored SQLite
  // format would be read as local time.
  return row?.at ? toIsoUtc(row.at) : null;
}

/** Seats the user holds in games that are still running (same lag caveat as {@link countActiveGamesOwned}). */
export async function countActiveGamesJoined(
  db: Reader,
  userId: string,
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  const { games, gamePlayers } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(
      and(eq(gamePlayers.userId, userId), ne(games.status, 'ended'), gt(games.endDate, nowIso)),
    );
  return Number(row?.n ?? 0);
}

/** Trade statuses that count as open orders — both are re-quoted every tick. */
export const OPEN_ORDER_STATUSES = ['working', 'pending'] as const;

/** {@link OPEN_ORDER_STATUSES} rows one game-player holds. */
export async function countOpenOrders(db: Reader, gamePlayerId: string): Promise<number> {
  const { trades } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(trades)
    .where(
      and(eq(trades.gamePlayerId, gamePlayerId), inArray(trades.status, [...OPEN_ORDER_STATUSES])),
    );
  return Number(row?.n ?? 0);
}

/**
 * Throws {@link LimitExceededError} when adding `rowsToInsert` open orders
 * would pass `limit.max`. A bracket inserts three rows, so the check is on the
 * total after insert rather than the usual `count >= max`. Call it inside the
 * transaction that inserts, so SQLite's single writer makes it exact.
 */
export async function assertOpenOrderCapacity(
  db: Reader,
  gamePlayerId: string,
  rowsToInsert: number,
  limit: ResolvedLimit | undefined,
): Promise<void> {
  if (!limit || limit.max === null) return;
  const open = await countOpenOrders(db, gamePlayerId);
  if (open + rowsToInsert > limit.max) {
    throw new LimitExceededError({ ...limit, max: limit.max });
  }
}

/** Accounts registered from `ip` at or after `since` ({@link toSqlTimestamp} format). */
export async function countRegistrationsSince(
  db: Reader,
  ip: string,
  since: string,
): Promise<number> {
  const { users } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.registrationIp, ip), gte(users.createdAt, since)));
  return Number(row?.n ?? 0);
}

/** ISO UTC time of the oldest account registered from `ip` at or after `since` ({@link toSqlTimestamp} format); null when none. */
export async function oldestRegistrationSince(
  db: Reader,
  ip: string,
  since: string,
): Promise<string | null> {
  const { users } = schema;
  const [row] = await db
    .select({ at: min(users.createdAt) })
    .from(users)
    .where(and(eq(users.registrationIp, ip), gte(users.createdAt, since)));
  // ISO, because `secondsUntilWindowFrees` parses it and the stored SQLite
  // format would be read as local time.
  return row?.at ? toIsoUtc(row.at) : null;
}
