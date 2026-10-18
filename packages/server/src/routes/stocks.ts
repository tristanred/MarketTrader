import { withPrivilegedIp } from '../limits/rate.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Db } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { RANGE_BAR_SECONDS, StockProviderError } from '../providers/index.js';
import type { ConfigReader } from '../config/runtime-config.js';
import { setRetryAfter } from './retry-after.js';
import { sendStockProviderError } from './stock-provider-error.js';

/** `:symbol` route param: 1–10 chars, upper-cased. Shared with the stock-analysis routes. */
export const symbolParamsSchema = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
});
const searchQuerySchema = z.object({ q: z.string().min(1).max(50) });
const HISTORY_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y'] as const;
const historyQuerySchema = z.object({
  range: z.enum(HISTORY_RANGES).default('1d'),
});

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
export function stockRoutes(_db: Db, provider: StockProvider, config: ConfigReader) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    // These routes are unauthenticated and proxy the external StockProvider, so
    // an anonymous caller could otherwise drive upstream cost and trip the
    // provider's own rate-limit backoff — which trading shares. A modest
    // per-IP cap keeps that in check while staying generous for real use.
    // search is keyed by query (distinct queries bypass the cache → upstream),
    // so it gets a tighter limit than the symbol-keyed lookups.
    const searchRateLimit = { rateLimit: withPrivilegedIp(config, { max: 30, timeWindow: '1 minute' }) };
    const lookupRateLimit = { rateLimit: withPrivilegedIp(config, { max: 120, timeWindow: '1 minute' }) };

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
            setRetryAfter(reply, config);
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
            barSeconds: RANGE_BAR_SECONDS[range],
            fetchedAt: new Date().toISOString(),
          });
        } catch (err) {
          if (err instanceof StockProviderError) {
            if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
            if (err.code === 'RATE_LIMITED') {
              setRetryAfter(reply, config);
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
        if (err instanceof StockProviderError) return sendStockProviderError(reply, err, config);
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
        if (err instanceof StockProviderError) return sendStockProviderError(reply, err, config);
        throw err;
      }
    });
  };
}
