import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '../../db/index.js';
import { cancelPendingTrade } from '../../services/pending-trade.js';

declare const db: any;
const { gamePlayers, trades } = schema;

// POSITIVE: refunds the buy side only, then flips a pending row.
export async function adminCancel(id: string, row: any) {
  await db.transaction(async (tx: any) => {
    if (row.direction === 'buy') {
      await tx.update(gamePlayers).set({ cashBalance: sql`${gamePlayers.cashBalance} + ${row.reservedCash}` }).where(eq(gamePlayers.id, row.gamePlayerId));
    }
    await tx
      .update(trades)
      .set({ status: 'cancelled', cancelReason: 'admin' })
      .where(and(eq(trades.id, id), eq(trades.status, 'pending')));
  });
}

// POSITIVE: bulk cancel of working rows via inArray, schema.trades spelling.
export async function bulkCancel(ids: string[]) {
  await db.update(schema.trades).set({ status: 'cancelled' }).where(and(inArray(trades.id, ids), inArray(trades.status, ['working'])));
}

// POSITIVE (one result, both statuses): raw sql guard, as executeTrade writes it.
export async function rawGuardCancel(id: string) {
  await db
    .update(trades)
    .set({ status: 'cancelled' })
    .where(and(eq(trades.id, id), sql`${trades.status} IN ('working', 'pending')`));
}

// POSITIVE: where clause built in a variable first.
export async function prebuiltWhere(id: string) {
  const cond = and(eq(trades.id, id), eq(trades.status, 'pending'));
  await db.update(trades).set({ status: 'cancelled' }).where(cond);
}

// NEGATIVE: uses the helper.
export async function viaHelper(gamePlayerId: string, id: string) {
  await cancelPendingTrade(db, gamePlayerId, id);
}

// NEGATIVE: reversal of an executed trade (status checked before, where has no open status).
export async function reverse(id: string) {
  await db.update(trades).set({ status: 'cancelled', cancelReason: 'admin_reverse' }).where(eq(trades.id, id));
}

// NEGATIVE: not a cancel.
export async function markExecuted(id: string) {
  await db.update(trades).set({ status: 'executed' }).where(and(eq(trades.id, id), eq(trades.status, 'pending')));
}
