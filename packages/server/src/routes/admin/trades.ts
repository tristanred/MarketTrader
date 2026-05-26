import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { recordAdminAction } from '../../services/admin-audit.js';
import {
  cancelWorkingOrder,
  WorkingOrderNotFoundError,
} from '../../services/working-order.js';
import { executeTrade } from '../../services/trade.js';
import type { StockProvider } from '../../providers/index.js';
import type { EventBus } from '../../events/bus.js';

const idParams = z.object({ id: z.string() });
const forceExecBody = z.object({ price: z.number().positive().optional() });
const priceBody = z.object({ price: z.number().positive() });

/**
 * Registers admin trade-surgery routes (all require requireAdmin):
 *   DELETE /admin/trades/:id           — cancel a working/pending trade
 *   POST   /admin/trades/:id/force-execute  — fill a working/pending trade now
 *   POST   /admin/trades/:id/reverse   — undo an executed trade (refuses if
 *                                        it would violate cash/holding invariants)
 *   PATCH  /admin/trades/:id/price     — adjust the recorded fill price; cash
 *                                        delta is applied, holdings unchanged.
 *                                        Refuses if it would push cash < 0.
 */
export function adminTradesRoutes(db: Db, provider: StockProvider, bus?: EventBus) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { trades, gamePlayers, portfolios } = schema;

    app.delete('/admin/trades/:id', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Cancel a working/pending trade.', security: [{ bearerAuth: [] }], params: idParams },
    }, async (request, reply) => {
      const { id } = request.params;
      const adminId = request.user.id;

      const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
      if (!trade) return reply.status(404).send({ error: 'Trade not found' });
      if (trade.status !== 'working' && trade.status !== 'pending') {
        return reply.status(409).send({ error: 'invalid_status', message: `Trade is ${trade.status}` });
      }

      if (trade.status === 'working') {
        try {
          await cancelWorkingOrder(db, trade.gamePlayerId, id, 'admin_cancel');
        } catch (err) {
          if (err instanceof WorkingOrderNotFoundError) return reply.status(409).send({ error: 'race_lost' });
          throw err;
        }
      } else {
        // Pending market-hours order: refund reservedCash for buys, then flip.
        await db.transaction(async (tx) => {
          if (trade.direction === 'buy' && trade.reservedCash != null) {
            const [pl] = await tx.select({ cashBalance: gamePlayers.cashBalance }).from(gamePlayers).where(eq(gamePlayers.id, trade.gamePlayerId)).limit(1);
            if (pl) {
              await tx
                .update(gamePlayers)
                .set({ cashBalance: Number(pl.cashBalance) + Number(trade.reservedCash) })
                .where(eq(gamePlayers.id, trade.gamePlayerId));
            }
          }
          await tx
            .update(trades)
            .set({ status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: 'admin_cancel' })
            .where(and(eq(trades.id, id), eq(trades.status, 'pending')));
        });
      }

      await db.transaction(async (tx) => {
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'trade.cancel',
          targetType: 'trade',
          targetId: id,
          before: { status: trade.status },
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/trades/:id/force-execute', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Fill a working/pending trade at current quote or override price.', security: [{ bearerAuth: [] }], params: idParams, body: forceExecBody },
    }, async (request, reply) => {
      const { id } = request.params;
      const { price: overridePrice } = request.body;
      const adminId = request.user.id;

      const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
      if (!trade) return reply.status(404).send({ error: 'Trade not found' });
      if (trade.status !== 'working' && trade.status !== 'pending') {
        return reply.status(409).send({ error: 'invalid_status', message: `Trade is ${trade.status}` });
      }

      const price = overridePrice ?? (await provider.getQuote(trade.symbol)).price;

      try {
        const executed = await executeTrade(db, {
          gamePlayerId: trade.gamePlayerId,
          symbol: trade.symbol,
          direction: trade.direction,
          quantity: trade.quantity,
          price,
          existingTradeId: id,
          reservedCash: trade.reservedCash == null ? 0 : Number(trade.reservedCash),
        });

        await db.transaction(async (tx) => {
          await recordAdminAction(tx, {
            adminUserId: adminId,
            action: 'trade.force_execute',
            targetType: 'trade',
            targetId: id,
            before: { status: trade.status, price: trade.price },
            after: { status: 'executed', price },
            metadata: { overrideUsed: overridePrice !== undefined },
          });
        });

        // Emit on the in-process bus so the achievement engine (and any
        // other domain-event consumer) treats an admin-driven force-execute
        // the same as a normal fill. Without this, achievements like
        // first-trade and ten-buys would silently skip admin-resolved
        // orders. Mirrors the emit in routes/trading.ts.
        if (bus) {
          // The trades table has no gameId column; resolve via gamePlayers.
          const [player] = await db
            .select({ gameId: gamePlayers.gameId })
            .from(gamePlayers)
            .where(eq(gamePlayers.id, trade.gamePlayerId))
            .limit(1);
          if (player) {
            void bus.emit({
              type: 'trade.executed',
              gameId: player.gameId,
              gamePlayerId: trade.gamePlayerId,
              symbol: trade.symbol,
              direction: trade.direction as 'buy' | 'sell',
              quantity: trade.quantity,
              price: Number(executed.price),
              tradeId: id,
              executedAt: executed.executedAt!,
            });
          }
        }

        return reply.status(200).send(executed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(409).send({ error: 'execute_failed', message: msg });
      }
    });

    app.post('/admin/trades/:id/reverse', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Undo an executed trade; refuses if it would violate cash/holding invariants.', security: [{ bearerAuth: [] }], params: idParams },
    }, async (request, reply) => {
      const { id } = request.params;
      const adminId = request.user.id;

      const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
      if (!trade) return reply.status(404).send({ error: 'Trade not found' });
      if (trade.status !== 'executed' || trade.price == null) {
        return reply.status(409).send({ error: 'invalid_status', message: 'Only executed trades can be reversed.' });
      }

      const price = Number(trade.price);
      const [pl] = await db.select({ cashBalance: gamePlayers.cashBalance }).from(gamePlayers).where(eq(gamePlayers.id, trade.gamePlayerId)).limit(1);
      if (!pl) return reply.status(404).send({ error: 'Player not found for this trade' });
      const [hold] = await db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.gamePlayerId, trade.gamePlayerId), eq(portfolios.symbol, trade.symbol)))
        .limit(1);
      const currentQty = hold?.quantity ?? 0;
      const currentCash = Number(pl.cashBalance);

      let newCash: number;
      let newQty: number;
      if (trade.direction === 'buy') {
        // Undoing a buy: refund cash, remove shares.
        newCash = currentCash + price * trade.quantity;
        newQty = currentQty - trade.quantity;
      } else {
        // Undoing a sell: charge cash, restore shares.
        newCash = currentCash - price * trade.quantity;
        newQty = currentQty + trade.quantity;
      }

      if (newCash < 0 || newQty < 0) {
        return reply.status(409).send({
          error: 'would_violate_invariants',
          message: 'Reversing this trade would push cash or holdings negative.',
          projected: { cashBalance: newCash, quantity: newQty },
        });
      }

      await db.transaction(async (tx) => {
        await tx.update(gamePlayers).set({ cashBalance: newCash }).where(eq(gamePlayers.id, trade.gamePlayerId));
        if (newQty === 0 && hold) {
          await tx.delete(portfolios).where(eq(portfolios.id, hold.id));
        } else if (hold) {
          await tx.update(portfolios).set({ quantity: newQty }).where(eq(portfolios.id, hold.id));
        } else if (newQty > 0) {
          // Reversing a sell when the player no longer holds this symbol: re-create the row at the trade's price as cost basis.
          await tx.insert(portfolios).values({
            gamePlayerId: trade.gamePlayerId,
            symbol: trade.symbol,
            quantity: newQty,
            avgCostBasis: price,
          });
        }
        await tx
          .update(trades)
          .set({ status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: 'admin_reverse' })
          .where(eq(trades.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'trade.reverse',
          targetType: 'trade',
          targetId: id,
          before: { status: 'executed', cashBalance: currentCash, quantity: currentQty },
          after: { status: 'cancelled', cashBalance: newCash, quantity: newQty },
        });
      });

      return reply.status(204).send();
    });

    app.patch('/admin/trades/:id/price', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Adjust the recorded fill price; cash delta is applied. Refuses if cash would go negative.', security: [{ bearerAuth: [] }], params: idParams, body: priceBody },
    }, async (request, reply) => {
      const { id } = request.params;
      const { price: newPrice } = request.body;
      const adminId = request.user.id;

      const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
      if (!trade) return reply.status(404).send({ error: 'Trade not found' });
      if (trade.status !== 'executed' || trade.price == null) {
        return reply.status(409).send({ error: 'invalid_status', message: 'Only executed trades support price edits.' });
      }

      const oldPrice = Number(trade.price);
      // Buy: paid more = cash goes down. Sell: received more = cash goes up.
      const cashDelta = trade.direction === 'buy'
        ? (oldPrice - newPrice) * trade.quantity
        : (newPrice - oldPrice) * trade.quantity;

      const [pl] = await db.select({ cashBalance: gamePlayers.cashBalance }).from(gamePlayers).where(eq(gamePlayers.id, trade.gamePlayerId)).limit(1);
      if (!pl) return reply.status(404).send({ error: 'Player not found for this trade' });
      const newCash = Number(pl.cashBalance) + cashDelta;
      if (newCash < 0) {
        return reply.status(409).send({
          error: 'would_violate_invariants',
          message: 'Editing price would push cash negative.',
          projected: { cashBalance: newCash },
        });
      }

      await db.transaction(async (tx) => {
        await tx.update(gamePlayers).set({ cashBalance: newCash }).where(eq(gamePlayers.id, trade.gamePlayerId));
        await tx.update(trades).set({ price: newPrice }).where(eq(trades.id, id));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'trade.edit_price',
          targetType: 'trade',
          targetId: id,
          before: { price: oldPrice },
          after: { price: newPrice },
          metadata: { cashDelta },
        });
      });

      return reply.status(204).send();
    });
  };
}
