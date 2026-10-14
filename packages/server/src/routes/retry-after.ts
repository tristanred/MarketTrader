import type { FastifyReply } from 'fastify';
import type { ConfigReader } from '../config/runtime-config.js';

/** Sets a Retry-After header (seconds) based on the configured 429 backoff. */
export function setRetryAfter(reply: FastifyReply, config: ConfigReader): void {
  reply.header('Retry-After', Math.ceil(config.get('STOCK_RATE_LIMIT_BACKOFF_MS') / 1000));
}
