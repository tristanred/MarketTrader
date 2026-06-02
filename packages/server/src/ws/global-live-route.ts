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
        let payload: { id: string; username: string; type?: string };
        try {
          payload = app.jwt.verify<{ id: string; username: string; type?: string }>(token);
        } catch {
          socket.close(1008, 'Invalid token');
          return;
        }
        // Reject the long-lived (7-day) refresh token as a socket credential —
        // only the 15-minute access token should authenticate connections. The
        // token rides in the URL query string (proxy logs, browser history), so
        // a refresh token there would be a long-lived credential in a bad place.
        if (payload.type === 'refresh') {
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
