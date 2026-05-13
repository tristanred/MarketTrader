import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError } from '../providers/index.js';
import { env } from '../env.js';

const symbolSchema = z.string().min(1).max(10).transform((s) => s.toUpperCase());
const searchSchema = z.object({ q: z.string().min(1).max(50) });
const HISTORY_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y'] as const;
const historyQuerySchema = z.object({
  range: z.enum(HISTORY_RANGES).default('1d'),
});

/** Sets a Retry-After header (seconds) based on the configured 429 backoff. */
function setRetryAfter(reply: FastifyReply): void {
  reply.header('Retry-After', Math.ceil(env.STOCK_RATE_LIMIT_BACKOFF_MS / 1000));
}

/**
 * Registers public stock-lookup routes (no authentication required):
 * - `GET /stocks/search?q=<query>` — symbol autocomplete via the provider.
 * - `GET /stocks/:symbol`          — current quote for a single ticker.
 *
 * Both routes delegate to the injected {@link StockProvider} so the actual
 * data source can be swapped via `STOCK_PROVIDER` without touching this file.
 *
 * Provider errors map to:
 * - `SYMBOL_NOT_FOUND` → 404
 * - `RATE_LIMITED`     → 429 (with `Retry-After` header)
 * - `PROVIDER_ERROR`   → 502
 */
export function stockRoutes(_db: Db, provider: StockProvider) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/stocks/search', async (request, reply) => {
      const parsed = searchSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues });
      }
      try {
        const results = await provider.searchSymbols(parsed.data.q);
        return reply.status(200).send(results);
      } catch (err) {
        if (err instanceof StockProviderError) {
          if (err.code === 'RATE_LIMITED') {
            setRetryAfter(reply);
            return reply.status(429).send({ code: err.code, message: err.message });
          }
          return reply.status(502).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    });

    app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>(
      '/stocks/:symbol/history',
      async (request, reply) => {
        const parsedSymbol = symbolSchema.safeParse(request.params.symbol);
        if (!parsedSymbol.success) {
          return reply.status(400).send({ error: 'Invalid symbol' });
        }
        const parsedQuery = historyQuerySchema.safeParse(request.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: parsedQuery.error.issues });
        }
        try {
          const bars = await provider.getHistory(parsedSymbol.data, parsedQuery.data.range);
          return reply.status(200).send({
            symbol: parsedSymbol.data,
            range: parsedQuery.data.range,
            bars,
            fetchedAt: new Date().toISOString(),
          });
        } catch (err) {
          if (err instanceof StockProviderError) {
            if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
            if (err.code === 'RATE_LIMITED') {
              setRetryAfter(reply);
              return reply.status(429).send({ code: err.code, message: err.message });
            }
            return reply.status(502).send({ code: err.code, message: err.message });
          }
          throw err;
        }
      },
    );

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
          if (err.code === 'RATE_LIMITED') {
            setRetryAfter(reply);
            return reply.status(429).send({ code: err.code, message: err.message });
          }
          return reply.status(502).send({ error: err.message });
        }
        throw err;
      }
    });
  };
}
