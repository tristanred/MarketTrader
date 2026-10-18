import type { FastifyReply } from 'fastify';
import type { ConfigReader } from '../config/runtime-config.js';
import type { StockProviderError } from '../providers/index.js';
import { setRetryAfter } from './retry-after.js';

/**
 * Answers a {@link StockProviderError} the way every stock lookup route does:
 * `SYMBOL_NOT_FOUND` → 404, `RATE_LIMITED` → 429 with `Retry-After`, anything else → 502.
 */
export function sendStockProviderError(reply: FastifyReply, err: StockProviderError, config: ConfigReader) {
  if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
  if (err.code === 'RATE_LIMITED') {
    setRetryAfter(reply, config);
    return reply.status(429).send({ code: err.code, message: err.message });
  }
  return reply.status(502).send({ error: err.message });
}
