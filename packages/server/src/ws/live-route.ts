import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { GameClientRegistry } from './registry.js';
import type { WsClientEvent, WsSubscribeEvent } from '@markettrader/shared';

/**
 * Registers the WebSocket upgrade route for live game events.
 * Authentication is validated via a JWT passed in the `?token=` query param.
 * Only verified game members are admitted; all others are closed with code 1008.
 */
export function liveRoute(db: Db, registry: GameClientRegistry) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
      '/games/:id/live',
      { websocket: true, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (socket, request: FastifyRequest<{ Params: { id: string }; Querystring: { token?: string } }>) => {
        const gameId = request.params.id;
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

        const [membership] = await db
          .select({ id: schema.gamePlayers.id })
          .from(schema.gamePlayers)
          .where(and(eq(schema.gamePlayers.gameId, gameId), eq(schema.gamePlayers.userId, payload.id)))
          .limit(1);

        if (!membership) {
          socket.close(1008, 'Not a game member');
          return;
        }

        registry.add(gameId, payload.id, socket);

        socket.on('message', (raw: Buffer) => {
          try {
            const event = JSON.parse(raw.toString()) as WsClientEvent;
            if (event.event === 'subscribe') {
              const symbols = (event as WsSubscribeEvent).data?.symbols;
              if (!Array.isArray(symbols)) return;
              const entry = registry.getEntry(gameId, socket);
              if (entry) {
                // Replace, not append: the client sends the full active set on
                // every change, and additive merging would broadcast forever
                // to symbols the user has dropped (e.g. when switching lists).
                entry.subscriptions.clear();
                for (const symbol of symbols) {
                  if (typeof symbol === 'string') {
                    entry.subscriptions.add(symbol.toUpperCase());
                  }
                }
              }
            }
          } catch {
            // Swallow — malformed client messages must not propagate
          }
        });

        const cleanup = () => registry.remove(gameId, socket);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
      },
    );
  };
}
