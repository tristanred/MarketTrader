import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { GlobalClientRegistry } from './global-registry.js';
import { ACCESS_TOKEN_TYPE } from '../plugins/jwt.js';

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
        // Only the 15-minute access token may authenticate a connection. The
        // token rides in the URL query string (proxy logs, browser history), so
        // the long-lived (7-day) refresh token there would be a durable
        // credential in a bad place. Demanding a positive `access` claim rather
        // than denying `refresh` also fails closed on an unstamped token.
        if (payload.type !== ACCESS_TOKEN_TYPE) {
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
