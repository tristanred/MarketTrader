import { and, eq } from 'drizzle-orm';
import { games, gamePlayers, trades } from '../db/schema.pg';

export async function settle(
  db: any,
  bus: any,
  gamePlayerId: string,
  cost: number,
  quote: { price: number },
) {
  const [player] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, gamePlayerId)).limit(1);
  // BAD: string arithmetic on Postgres.
  const remaining = player.cashBalance - cost;
  // GOOD: coerced.
  const remainingOk = Number(player.cashBalance) - cost;
  // GOOD: unary plus coerces.
  const remainingPlus = +player.cashBalance - cost;
  // GOOD: display string concatenation is intended.
  const label = 'Cash: ' + player.cashBalance;
  // GOOD: not a Drizzle row; providers return numbers.
  const notional = quote.price * 2;

  const [trade] = await db.select().from(trades).where(eq(trades.gamePlayerId, gamePlayerId)).limit(1);
  // GOOD: null check is not a numeric use.
  if (trade.price == null) return;
  // BAD: lexicographic comparison on Postgres.
  if (trade.price > quote.price) return;

  const [game] = await db.select().from(games).limit(1);
  // GOOD: decimal-to-decimal pass-through.
  await db.insert(gamePlayers).values({ gameId: game.id, userId: 'u', cashBalance: game.startingBalance });

  const [updated] = await db
    .update(gamePlayers)
    .set({ cashBalance: remainingOk })
    .where(and(eq(gamePlayers.id, gamePlayerId)))
    .returning();
  // BAD: event consumers expect a number.
  bus.emit({ type: 'cash_changed', cashAfter: updated.cashBalance });
  // GOOD: coerced.
  bus.emit({ type: 'cash_changed', cashAfter: Number(updated.cashBalance) });
  return { remaining, remainingPlus, label, notional };
}
