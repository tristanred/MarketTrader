import type { FastifyInstance, FastifyReply } from 'fastify';
import { StockProviderError } from '../providers/index.js';
import type { MarketStatusProvider } from '../providers/market-status/index.js';
import { env } from '../env.js';

function setRetryAfter(reply: FastifyReply): void {
  reply.header('Retry-After', Math.ceil(env.STOCK_RATE_LIMIT_BACKOFF_MS / 1000));
}

/**
 * Public route exposing the current trading session.
 * - `RATE_LIMITED` → 429 with `Retry-After` header.
 * - any other upstream error → 502.
 *
 * Used by the frontend chart to decide whether to merge live ticks; see
 * `packages/frontend/src/components/StockChart.tsx`.
 */
export function marketStatusRoutes(provider: MarketStatusProvider) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/market/status', {
      schema: {
        tags: ['Market'],
        summary: 'Current trading session status (PRE / REGULAR / POST / CLOSED).',
      },
    }, async (_req, reply) => {
      try {
        const status = await provider.getStatus();
        return reply.status(200).send(status);
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
  };
}
