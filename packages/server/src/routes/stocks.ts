import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Db } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError } from '../providers/index.js';
import { env } from '../env.js';

const symbolParamsSchema = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
});
const searchQuerySchema = z.object({ q: z.string().min(1).max(50) });
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
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    // These routes are unauthenticated and proxy the external StockProvider, so
    // an anonymous caller could otherwise drive upstream cost and trip the
    // provider's own rate-limit backoff — which trading shares. A modest
    // per-IP cap keeps that in check while staying generous for real use.
    // search is keyed by query (distinct queries bypass the cache → upstream),
    // so it gets a tighter limit than the symbol-keyed lookups.
    const searchRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
    const lookupRateLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } };

    app.get('/stocks/search', {
      config: searchRateLimit,
      schema: {
        tags: ['Stocks'],
        summary: 'Symbol autocomplete.',
        querystring: searchQuerySchema,
      },
    }, async (request, reply) => {
      try {
        const results = await provider.searchSymbols(request.query.q);
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

    app.get(
      '/stocks/:symbol/history',
      {
        config: lookupRateLimit,
        schema: {
          tags: ['Stocks'],
          summary: 'Historical OHLC bars for a symbol.',
          params: symbolParamsSchema,
          querystring: historyQuerySchema,
        },
      },
      async (request, reply) => {
        const { symbol } = request.params;
        const { range } = request.query;
        try {
          const bars = await provider.getHistory(symbol, range);
          return reply.status(200).send({
            symbol,
            range,
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

    app.get('/stocks/:symbol/details', {
      config: lookupRateLimit,
      schema: {
        tags: ['Stocks'],
        summary: 'Extended company/details metadata for a symbol.',
        params: symbolParamsSchema,
      },
    }, async (request, reply) => {
      try {
        const details = await provider.getDetails(request.params.symbol);
        return reply.status(200).send(details);
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

    app.get('/stocks/:symbol', {
      config: lookupRateLimit,
      schema: {
        tags: ['Stocks'],
        summary: 'Current quote for a single ticker.',
        params: symbolParamsSchema,
      },
    }, async (request, reply) => {
      try {
        const quote = await provider.getQuote(request.params.symbol);
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
