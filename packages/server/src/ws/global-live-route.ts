import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { GlobalClientRegistry } from './global-registry.js';

/**
 * Registers `/ws/live` — a global authenticated socket used for app-wide
 * chrome data (indices, ticker-tape config). Distinct from
 * `/games/:id/live` which is game-scoped.
 *
 * Auth: JWT in `?token=` query param, same shape as the per-game socket.
 */
export function globalLiveRoute(registry: GlobalClientRegistry) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get<{ Querystring: { token?: string } }>(
      '/ws/live',
      { websocket: true, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (socket, request: FastifyRequest<{ Querystring: { token?: string } }>) => {
        const { token } = request.query;
        if (!token) {
          socket.close(1008, 'Missing token');
          return;
        }
        let payload: { id: string; username: string };
        try {
          payload = app.jwt.verify<{ id: string; username: string }>(token);
        } catch {
          socket.close(1008, 'Invalid token');
          return;
        }
        registry.add(payload.id, socket);
        const cleanup = () => registry.remove(socket);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
      },
    );
  };
}
