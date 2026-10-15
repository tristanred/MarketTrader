import { and, eq, or } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { TradeError } from '../providers/index.js';

/**
 * Ceiling on `working` + `pending` rows one game-player may hold open.
 *
 * Resting rows are re-quoted by the trigger worker and the price poller on
 * every tick, so an unbounded pile of them is an unbounded outbound-request
 * amplifier against the shared upstream provider. Nothing expires them today:
 * `expireDayOrders` needs `expiresAt`, which the trade route never sets.
 */
export const MAX_OPEN_ORDERS_PER_PLAYER = 50;

/** A database handle or transaction that can run the count. */
export type OpenOrdersReader = Pick<Db, 'select'>;

/**
 * Throws `TOO_MANY_OPEN_ORDERS` when inserting `rowsToInsert` more resting rows
 * would push the player past `max`. Run it inside the inserting transaction so
 * the count and the insert see the same rows.
 *
 * @throws {TradeError} `TOO_MANY_OPEN_ORDERS`
 */
export async function assertOpenOrderCapacity(
  tx: OpenOrdersReader,
  gamePlayerId: string,
  rowsToInsert: number,
  max: number = MAX_OPEN_ORDERS_PER_PLAYER,
): Promise<void> {
  const { trades } = schema;
  const open = await tx
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.gamePlayerId, gamePlayerId),
        or(eq(trades.status, 'working'), eq(trades.status, 'pending')),
      ),
    );
  if (open.length + rowsToInsert > max) {
    throw new TradeError(
      'TOO_MANY_OPEN_ORDERS',
      `Too many open orders (limit ${max}); cancel one first`,
    );
  }
}
