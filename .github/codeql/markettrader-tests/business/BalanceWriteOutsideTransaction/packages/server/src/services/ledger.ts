import { eq, sql } from 'drizzle-orm';
import { schema } from '../db/index.js';

type Db = any;
declare const db: Db;
const { games, gamePlayers, portfolios } = schema;

// POSITIVE x3: cash and holdings written on the base connection.
export async function untransacted(id: string, symbol: string) {
  await db.update(gamePlayers).set({ cashBalance: sql`${gamePlayers.cashBalance} - ${1}` }).where(eq(gamePlayers.id, id));
  await db.delete(portfolios).where(eq(portfolios.id, id));
  await db.insert(schema.portfolios).values({ gamePlayerId: id, symbol, quantity: 1, avgCostBasis: 1 });
}

// NEGATIVE: everything through the tx handle.
export async function transacted(id: string) {
  await db.transaction(async (tx: Db) => {
    await tx.update(gamePlayers).set({ cashBalance: sql`${gamePlayers.cashBalance} + ${1}` }).where(eq(gamePlayers.id, id));
    await tx.delete(portfolios).where(eq(portfolios.id, id));
  });
}

// NEGATIVE: helper nested inside the callback, handle renamed.
export async function nestedHelper(id: string) {
  return db.transaction(async (tx: Db) => {
    await decrement(tx);

    async function decrement(txn: Db) {
      await txn.update(portfolios).set({ quantity: sql`${portfolios.quantity} - ${1}` }).where(eq(portfolios.id, id));
    }
  });
}

// NEGATIVE: helper declared outside the callback but only ever fed the tx (releaseReservation shape).
export async function helperAfterReturn(id: string) {
  await db.transaction(async (tx: Db) => {
    await release(tx as unknown as Db, id);
  });
  return;

  async function release(handle: Db, rowId: string) {
    await handle.insert(portfolios).values({ gamePlayerId: rowId, symbol: 'X', quantity: 1, avgCostBasis: 0 });
  }
}

// POSITIVE: helper fed a tx by one caller and the base connection by another.
async function refund(handle: Db, id: string) {
  await handle.update(gamePlayers).set({ cashBalance: sql`${gamePlayers.cashBalance} + ${1}` }).where(eq(gamePlayers.id, id));
}
export async function refundInTx(id: string) {
  await db.transaction(async (tx: Db) => {
    await refund(tx, id);
  });
}
export async function refundBare(id: string) {
  await refund(db, id);
}

// POSITIVE: creator seat inserted outside the transaction that should pair it with the game.
export async function createGame(userId: string) {
  const [game] = await db.insert(games).values({ name: 'g', createdBy: userId }).returning();
  await db.insert(gamePlayers).values({ gameId: game.id, userId, cashBalance: 1000 });
}

// NEGATIVE: a lone seat insert is a single atomic statement.
export async function joinGame(gameId: string, userId: string) {
  await db.insert(gamePlayers).values({ gameId, userId, cashBalance: 1000 });
}

// NEGATIVE: both inserts in one transaction.
export async function createGameAtomically(userId: string) {
  await db.transaction(async (tx: Db) => {
    const [game] = await tx.insert(games).values({ name: 'g', createdBy: userId }).returning();
    await tx.insert(gamePlayers).values({ gameId: game.id, userId, cashBalance: 1000 });
  });
}

// NEGATIVE: non-cash column on gamePlayers.
export async function ackUnlock(id: string) {
  await db.update(gamePlayers).set({ lastSeenUnlockAt: 'now' }).where(eq(gamePlayers.id, id));
}
