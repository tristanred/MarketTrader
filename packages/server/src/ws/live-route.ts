import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt, isNotNull, asc, lte } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { GameClientRegistry } from './registry.js';
import type { AchievementEngine } from '../achievements/engine.js';
import type { WsClientEvent, WsSubscribeEvent } from '@markettrader/shared';

/**
 * Registers the WebSocket upgrade route for live game events.
 * Authentication is validated via a JWT passed in the `?token=` query param.
 * Only verified game members are admitted; all others are closed with code 1008.
 * On connect, replays any unlocked achievements the player has not yet acknowledged.
 */
export function liveRoute(db: Db, registry: GameClientRegistry, engine: AchievementEngine) {
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

        const [membership] = await db
          .select({ id: schema.gamePlayers.id, lastSeenUnlockAt: schema.gamePlayers.lastSeenUnlockAt })
          .from(schema.gamePlayers)
          .where(and(eq(schema.gamePlayers.gameId, gameId), eq(schema.gamePlayers.userId, payload.id)))
          .limit(1);

        if (!membership) {
          socket.close(1008, 'Not a game member');
          return;
        }

        // Capture the time before registering the socket so the replay SELECT
        // uses it as an upper bound. Any unlock with unlockedAt > connectTime
        // will be broadcast live by the engine (the socket is already in the
        // registry by then).
        const connectTime = new Date().toISOString();
        registry.add(gameId, payload.id, socket);

        // Replay any unlocked achievements the player has not yet acknowledged.
        // Wrapped in try/catch so a DB error never breaks the WS connection.
        try {
          const since = membership.lastSeenUnlockAt ?? '1970-01-01T00:00:00.000Z';
          const unacked = await db
            .select({
              achievementKey: schema.achievementProgress.achievementKey,
              unlockedAt: schema.achievementProgress.unlockedAt,
            })
            .from(schema.achievementProgress)
            .where(
              and(
                eq(schema.achievementProgress.gamePlayerId, membership.id),
                isNotNull(schema.achievementProgress.unlockedAt),
                gt(schema.achievementProgress.unlockedAt, since),
                // Ceiling: any unlock with unlocked_at > connectTime is the engine's job to
                // broadcast live (the socket is already registered). Without this bound we'd
                // race the engine and double-deliver unlocks that fire during the SELECT.
                lte(schema.achievementProgress.unlockedAt, connectTime),
              ),
            )
            .orderBy(asc(schema.achievementProgress.unlockedAt));

          for (const row of unacked) {
            const def = engine.getDefinition(row.achievementKey);
            // Skip achievements whose definition has been removed from the codebase
            if (!def) continue;
            registry.sendToSocket(socket, {
              event: 'achievement_unlocked',
              data: {
                gamePlayerId: membership.id,
                achievementKey: def.key,
                name: def.name,
                description: def.description,
                rarity: def.rarity,
                icon: def.icon,
                // row.unlockedAt is non-null — guaranteed by the isNotNull filter above
                unlockedAt: row.unlockedAt!,
                replayed: true,
              },
            });
          }
        } catch (err) {
          app.log.error({ err, gameId, gamePlayerId: membership.id }, 'achievement replay failed');
        }

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
