import { and, eq, gt } from 'drizzle-orm';
import { schema } from '../db/index.js';

declare function executeTrade(db: any, p: unknown): Promise<void>;
declare function recomputeGameStatus(db: any, g: unknown): Promise<string>;

const { games, gamePlayers, trades } = schema;

// POSITIVE: settles pending rows by status alone.
export async function settle(db: any) {
  const rows = await db
    .select({ row: trades })
    .from(trades)
    .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(and(eq(trades.status, 'pending'), eq(games.status, 'active')));
  for (const { row } of rows) {
    await db.transaction(async (tx: any) => {
      await tx.update(trades).set({ status: 'executed' }).where(eq(trades.id, row.id));
    });
  }
}

// POSITIVE: fills through executeTrade; schema.games spelling.
export async function evaluate(db: any) {
  const rows = await db.select().from(trades).where(and(eq(trades.status, 'working'), eq(schema.games.status, 'active')));
  for (const row of rows) await executeTrade(db, row);
}

// POSITIVE: the filter sits in a nested transaction callback; the fill is in the outer function.
export async function settleNested(db: any) {
  const rows = await db.transaction(async (tx: any) =>
    tx.select().from(trades).where(and(eq(trades.status, 'pending'), eq(games.status, 'active'))),
  );
  for (const row of rows) await executeTrade(db, row);
}

// NEGATIVE: endDate bounded in the same where.
export async function settleBounded(db: any, nowIso: string) {
  const rows = await db.select().from(trades).where(and(eq(games.status, 'active'), gt(games.endDate, nowIso)));
  for (const row of rows) await executeTrade(db, row);
}

// NEGATIVE: recomputes statuses before trusting them.
export async function settleAfterRecompute(db: any) {
  const live = await db.select().from(games).where(eq(games.status, 'active'));
  for (const g of live) await recomputeGameStatus(db, g);
  for (const row of await db.select().from(trades)) await executeTrade(db, row);
}

// NEGATIVE: same filter, but not a fill path (symbol listing).
export async function openSymbols(db: any) {
  return db.selectDistinct({ symbol: trades.symbol }).from(trades).where(eq(games.status, 'active'));
}
