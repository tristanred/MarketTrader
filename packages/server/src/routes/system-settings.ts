import type { FastifyInstance } from 'fastify';
import type { SystemSettingsService } from '../services/system-settings.js';
import type { TickerTapeSettings } from '@markettrader/shared';

/**
 * Public-authenticated read-only route for runtime configuration. Phase 2
 * exposes the ticker-tape symbol list so the frontend can render the
 * scrolling tape; admin write routes arrive in phase 4.
 */
export function systemSettingsRoutes(svc: SystemSettingsService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get<{ Reply: TickerTapeSettings | { error: string } }>(
      '/system-settings/ticker-tape',
      { onRequest: app.authenticate },
      async (_req, reply) => {
        const tape = await svc.getTickerTapeSymbols();
        if (!tape) {
          return reply.code(500).send({ error: 'ticker tape not seeded' });
        }
        return reply.send(tape);
      },
    );
  };
}
