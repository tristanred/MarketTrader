import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { recordAdminAction } from '../../services/admin-audit.js';

const playerParams = z.object({ playerId: z.string() });

const cashBody = z.object({
  cashBalance: z.number().nonnegative(),
  reason: z.string().max(500).optional(),
});

const holdingsBody = z.object({
  symbol: z.string().min(1).max(10),
  quantityDelta: z.number().int(),
  costBasis: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Registers admin portfolio / cash routes (all require requireAdmin):
 *   PATCH  /admin/players/:playerId/cash      — set cashBalance to an absolute value
 *   POST   /admin/players/:playerId/holdings  — add/remove shares of one symbol
 *   DELETE /admin/players/:playerId/holdings  — wipe every holding (cash unchanged)
 */
export function adminPortfoliosRoutes(db: Db) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { gamePlayers, portfolios } = schema;

    app.patch('/admin/players/:playerId/cash', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Set a player\'s cash balance to an absolute value.', security: [{ bearerAuth: [] }], params: playerParams, body: cashBody },
    }, async (request, reply) => {
      const { playerId } = request.params;
      const { cashBalance, reason } = request.body;
      const adminId = request.user.id;

      const [existing] = await db
        .select({ id: gamePlayers.id, cashBalance: gamePlayers.cashBalance })
        .from(gamePlayers)
        .where(eq(gamePlayers.id, playerId))
        .limit(1);
      if (!existing) return reply.status(404).send({ error: 'Player not found' });

      await db.transaction(async (tx) => {
        await tx.update(gamePlayers).set({ cashBalance }).where(eq(gamePlayers.id, playerId));
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'portfolio.update_cash',
          targetType: 'portfolio',
          targetId: playerId,
          before: { cashBalance: Number(existing.cashBalance) },
          after: { cashBalance },
          metadata: reason ? { reason } : undefined,
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/players/:playerId/holdings', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Adjust holdings: positive delta adds shares, negative removes.', security: [{ bearerAuth: [] }], params: playerParams, body: holdingsBody },
    }, async (request, reply) => {
      const { playerId } = request.params;
      const { symbol, quantityDelta, costBasis, reason } = request.body;
      const adminId = request.user.id;

      if (quantityDelta === 0) return reply.status(400).send({ error: 'quantityDelta must be non-zero' });

      const [player] = await db.select({ id: gamePlayers.id }).from(gamePlayers).where(eq(gamePlayers.id, playerId)).limit(1);
      if (!player) return reply.status(404).send({ error: 'Player not found' });

      const [existing] = await db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.gamePlayerId, playerId), eq(portfolios.symbol, symbol)))
        .limit(1);

      const currentQty = existing?.quantity ?? 0;
      const newQty = currentQty + quantityDelta;
      if (newQty < 0) {
        return reply.status(409).send({ error: 'would_violate_invariants', message: 'Resulting quantity would be negative.' });
      }
      if (newQty > 0 && !existing && costBasis === undefined) {
        return reply.status(400).send({ error: 'costBasis is required when creating a new holding' });
      }

      await db.transaction(async (tx) => {
        if (newQty === 0) {
          await tx.delete(portfolios).where(and(eq(portfolios.gamePlayerId, playerId), eq(portfolios.symbol, symbol)));
        } else if (existing) {
          // Keep avg cost basis unchanged on removals; on additions, weight-average
          // existing avg with the new costBasis (or keep existing avg if not provided).
          let newAvg = Number(existing.avgCostBasis);
          if (quantityDelta > 0 && costBasis !== undefined) {
            newAvg = (Number(existing.avgCostBasis) * currentQty + costBasis * quantityDelta) / newQty;
          }
          await tx
            .update(portfolios)
            .set({ quantity: newQty, avgCostBasis: newAvg })
            .where(eq(portfolios.id, existing.id));
        } else {
          await tx.insert(portfolios).values({
            gamePlayerId: playerId,
            symbol,
            quantity: newQty,
            avgCostBasis: costBasis ?? 0,
          });
        }
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'portfolio.adjust_holdings',
          targetType: 'portfolio',
          targetId: playerId,
          before: existing ? { quantity: currentQty, avgCostBasis: Number(existing.avgCostBasis) } : null,
          after: { symbol, quantity: newQty },
          metadata: { quantityDelta, costBasis, reason },
        });
      });

      return reply.status(204).send();
    });

    app.delete('/admin/players/:playerId/holdings', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Wipe all holdings for a player (cash unchanged).', security: [{ bearerAuth: [] }], params: playerParams },
    }, async (request, reply) => {
      const { playerId } = request.params;
      const adminId = request.user.id;

      const [player] = await db.select({ id: gamePlayers.id }).from(gamePlayers).where(eq(gamePlayers.id, playerId)).limit(1);
      if (!player) return reply.status(404).send({ error: 'Player not found' });

      const result = await db.transaction(async (tx) => {
        const rows = await tx.delete(portfolios).where(eq(portfolios.gamePlayerId, playerId)).returning({ id: portfolios.id });
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'portfolio.wipe_holdings',
          targetType: 'portfolio',
          targetId: playerId,
          metadata: { holdingsWiped: rows.length },
        });
        return rows.length;
      });

      return reply.status(200).send({ holdingsWiped: result });
    });
  };
}
