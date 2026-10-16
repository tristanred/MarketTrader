import { and, eq } from 'drizzle-orm';
import { schema } from '../db/index.js';

const { trades } = schema;

// NEGATIVE: the lifecycle service owns the reservation release.
export async function cancelPendingTrade(db: any, gamePlayerId: string, id: string) {
  await db.transaction(async (tx: any) => {
    await tx
      .update(trades)
      .set({ status: 'cancelled' })
      .where(and(eq(trades.id, id), eq(trades.gamePlayerId, gamePlayerId), eq(trades.status, 'pending')));
  });
}
