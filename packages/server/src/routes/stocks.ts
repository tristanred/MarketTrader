import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError } from '../providers/index.js';

const symbolSchema = z.string().min(1).max(10).transform((s) => s.toUpperCase());
const searchSchema = z.object({ q: z.string().min(1).max(50) });

/**
 * Registers public stock-lookup routes (no authentication required):
 * - `GET /stocks/search?q=<query>` — symbol autocomplete via the provider.
 * - `GET /stocks/:symbol`          — current quote for a single ticker.
 *
 * Both routes delegate to the injected {@link StockProvider} so the actual
 * data source can be swapped via `STOCK_PROVIDER` without touching this file.
 */
export function stockRoutes(_db: Db, provider: StockProvider) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/stocks/search', async (request, reply) => {
      const parsed = searchSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues });
      }
      const results = await provider.searchSymbols(parsed.data.q);
      return reply.status(200).send(results);
    });

    app.get<{ Params: { symbol: string } }>('/stocks/:symbol', async (request, reply) => {
      const parsed = symbolSchema.safeParse(request.params.symbol);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid symbol' });
      }
      try {
        const quote = await provider.getQuote(parsed.data);
        return reply.status(200).send(quote);
      } catch (err) {
        if (err instanceof StockProviderError) {
          if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
          if (err.code === 'RATE_LIMITED') return reply.status(429).send({ error: err.message });
          return reply.status(502).send({ error: err.message });
        }
        throw err;
      }
    });
  };
}
