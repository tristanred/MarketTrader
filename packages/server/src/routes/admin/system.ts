import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { count } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { recordAdminAction } from '../../services/admin-audit.js';
import type { SystemSettingsService } from '../../services/system-settings.js';

const symbolParams = z.object({ symbol: z.string().min(1).max(10) });
const priceBody = z.object({
  price: z.number().positive(),
  change: z.number().optional(),
  changePercent: z.number().optional(),
});
const tickerTapeBody = z.object({
  symbols: z.array(z.string().trim().min(1).max(12)).min(1).max(100),
});

const PROCESS_START = Date.now();

/**
 * Registers system-level admin endpoints (all require requireAdmin):
 *   PATCH /admin/stocks/:symbol/price — overwrite a price-cache entry
 *   POST  /admin/stocks/cache/flush   — truncate stock_price_cache
 *   GET   /admin/stats                — uptime + row counts
 *
 * Market-hours override is not currently exposed — the market-status provider
 * doesn't carry an admin hook yet, and threading one through is its own piece
 * of work. Tracked as a follow-up.
 */
export function adminSystemRoutes(db: Db, systemSettings: SystemSettingsService) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { stockPriceCache, users, games, gamePlayers, trades, portfolios, adminAuditLog } = schema;

    app.patch('/admin/stocks/:symbol/price', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Overwrite a price-cache entry for a symbol.', security: [{ bearerAuth: [] }], params: symbolParams, body: priceBody },
    }, async (request, reply) => {
      const { symbol } = request.params;
      const { price, change, changePercent } = request.body;
      const adminId = request.user.id;
      const sym = symbol.toUpperCase();

      await db.transaction(async (tx) => {
        await tx
          .insert(stockPriceCache)
          .values({
            symbol: sym,
            price,
            change: change ?? 0,
            changePercent: changePercent ?? 0,
            fetchedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: stockPriceCache.symbol,
            set: {
              price,
              change: change ?? 0,
              changePercent: changePercent ?? 0,
              fetchedAt: new Date().toISOString(),
            },
          });
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'system.set_price',
          targetType: 'system',
          targetId: sym,
          after: { price, change, changePercent },
        });
      });

      return reply.status(204).send();
    });

    app.post('/admin/stocks/cache/flush', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Truncate the stock-price cache.', security: [{ bearerAuth: [] }] },
    }, async (request, reply) => {
      const adminId = request.user.id;
      const result = await db.transaction(async (tx) => {
        const deleted = await tx.delete(stockPriceCache).returning({ symbol: stockPriceCache.symbol });
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'system.flush_cache',
          targetType: 'system',
          metadata: { entriesRemoved: deleted.length },
        });
        return deleted.length;
      });

      return reply.status(200).send({ entriesRemoved: result });
    });

    app.get('/admin/stats', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Row counts + uptime.', security: [{ bearerAuth: [] }] },
    }, async (_request, reply) => {
      const [usersC, gamesC, playersC, tradesC, portfoliosC, auditC] = await Promise.all([
        db.select({ c: count() }).from(users),
        db.select({ c: count() }).from(games),
        db.select({ c: count() }).from(gamePlayers),
        db.select({ c: count() }).from(trades),
        db.select({ c: count() }).from(portfolios),
        db.select({ c: count() }).from(adminAuditLog),
      ]);

      return reply.status(200).send({
        websocketConnections: 0,
        rowCounts: {
          users: Number(usersC[0]?.c ?? 0),
          games: Number(gamesC[0]?.c ?? 0),
          gamePlayers: Number(playersC[0]?.c ?? 0),
          trades: Number(tradesC[0]?.c ?? 0),
          portfolios: Number(portfoliosC[0]?.c ?? 0),
          adminAuditLog: Number(auditC[0]?.c ?? 0),
        },
        uptimeSeconds: Math.floor((Date.now() - PROCESS_START) / 1000),
      });
    });

    /**
     * Replaces the ticker-tape symbol list atomically — the settings write and
     * audit-log entry land in the same transaction so neither can succeed
     * without the other. The 'change' event fired by the service causes
     * IndicesBroadcaster to refresh its subscription set.
     */
    app.put('/admin/system-settings/ticker-tape', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Replace the ticker-tape symbol list.',
        security: [{ bearerAuth: [] }],
        body: tickerTapeBody,
      },
    }, async (request, reply) => {
      const { symbols } = request.body;
      const adminId = request.user.id;

      const before = await systemSettings.getTickerTapeSymbols();
      const after = symbols.map((s) => s.trim().toUpperCase());

      await db.transaction(async (tx) => {
        await systemSettings.setTickerTapeSymbolsInTx(tx, symbols, adminId);
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'system.ticker_tape.update',
          targetType: 'system',
          targetId: 'ticker_tape_symbols',
          before: before ?? null,
          after: { symbols: after },
        });
      });

      const persisted = await systemSettings.getTickerTapeSymbols();
      return reply.send(persisted);
    });
  };
}
