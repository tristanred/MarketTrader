import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt, inArray, isNotNull, asc, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { WebSocket } from 'ws';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { ClientEntry, GameClientRegistry } from './registry.js';
import type { AchievementEngine } from '../achievements/engine.js';
import { ACCESS_TOKEN_TYPE } from '../plugins/jwt.js';
import { extractSubprotocolToken } from './subprotocol.js';
import { env } from '../env.js';

/** Claims read off the upgrade credential. `exp` is seconds since the epoch. */
interface AccessClaims {
  id: string;
  username: string;
  type?: string;
  exp?: number;
}

/**
 * Ceiling on a client's active symbol set. The client replaces the whole set on
 * every change, so this has to clear the largest legitimate one — holdings plus
 * every watchlist — while still bounding what a hostile client can retain.
 */
const MAX_SUBSCRIBED_SYMBOLS = 500;

/**
 * The only frame a client may send. Validated rather than cast: without it the
 * `symbols` array is attacker-sized and retained per socket until disconnect.
 */
const clientFrameSchema = z.object({
  event: z.literal('subscribe'),
  data: z.object({
    symbols: z.array(z.string().min(1).max(12)).max(MAX_SUBSCRIBED_SYMBOLS),
  }),
});

function closeSocket(socket: WebSocket, reason: string): void {
  try {
    socket.close(1008, reason);
  } catch {
    // Already closing or closed — nothing to revoke.
  }
}

/**
 * Re-runs the upgrade-time authorization decision against current state for
 * every registered socket: token still unexpired, account still present and
 * enabled, player still a member of the game. Anything that fails is closed.
 *
 * Without this a socket outlives the 15-minute token, an admin's
 * remove-player, and a disabled account, because nothing else re-reads the
 * database once the connection is in the broadcast room.
 */
async function revalidateSockets(
  db: Db,
  registry: GameClientRegistry,
  expiryOf: WeakMap<WebSocket, number>,
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const gameId of registry.getActiveGameIds()) {
    // Snapshot before the first await: a close landing mid-query mutates the
    // registry's map, and iterating it live would throw or skip entries.
    const clients: Array<[WebSocket, ClientEntry]> = [...registry.getClients(gameId)];
    const unexpired: Array<[WebSocket, ClientEntry]> = [];

    for (const [socket, entry] of clients) {
      const expiresAt = expiryOf.get(socket);
      if (expiresAt === undefined || expiresAt <= nowSeconds) {
        closeSocket(socket, 'Token expired');
        continue;
      }
      unexpired.push([socket, entry]);
    }

    if (unexpired.length === 0) continue;

    const userIds = [...new Set(unexpired.map(([, entry]) => entry.playerId))];
    const rows = await db
      .select({ userId: schema.gamePlayers.userId, disabled: schema.users.disabled })
      .from(schema.gamePlayers)
      .innerJoin(schema.users, eq(schema.users.id, schema.gamePlayers.userId))
      .where(
        and(
          eq(schema.gamePlayers.gameId, gameId),
          inArray(schema.gamePlayers.userId, userIds),
        ),
      );

    const stillAuthorized = new Set(
      rows.filter((row) => !row.disabled).map((row) => row.userId),
    );

    for (const [socket, entry] of unexpired) {
      if (!stillAuthorized.has(entry.playerId)) {
        closeSocket(socket, 'Authorization revoked');
      }
    }
  }
}

/**
 * Registers the WebSocket upgrade route for live game events.
 *
 * The access token is offered in the `Sec-WebSocket-Protocol` header — see
 * {@link extractSubprotocolToken} — never in the URL. Only enabled accounts
 * that are current members of the game are admitted; everyone else is closed
 * with 1008, and admitted sockets are re-checked on the interval below so a
 * revocation takes effect without waiting for the client to reconnect.
 *
 * On connect, replays any unlocked achievements the player has not yet
 * acknowledged.
 *
 * @param revalidateIntervalMs - Overrides `WS_REVALIDATE_INTERVAL_MS`; tests
 *   pass a small value to observe a sweep without waiting.
 */
export function liveRoute(
  db: Db,
  registry: GameClientRegistry,
  engine: AchievementEngine,
  revalidateIntervalMs: number = env.WS_REVALIDATE_INTERVAL_MS,
) {
  return async function (app: FastifyInstance): Promise<void> {
    // WeakMap rather than a field on ClientEntry: a socket that vanishes
    // without firing `close` cannot leak an entry here.
    const expiryOf = new WeakMap<WebSocket, number>();

    const sweep = setInterval(() => {
      void revalidateSockets(db, registry, expiryOf).catch((err: unknown) => {
        app.log.error({ err }, 'ws revalidation sweep failed');
      });
    }, revalidateIntervalMs);
    // Never hold the process open: this timer runs for the lifetime of the
    // app, including in test runs that build an app and forget to close it.
    sweep.unref?.();
    app.addHook('onClose', async () => {
      clearInterval(sweep);
    });

    app.get<{ Params: { id: string } }>(
      '/games/:id/live',
      // otel:false — the "request" here is a WebSocket upgrade that stays open
      // for the length of a session, so a request span would sit unfinished for
      // hours and never describe anything useful.
      {
        websocket: true,
        config: { rateLimit: { max: 10, timeWindow: '1 minute' }, otel: false },
      },
      async (socket, request: FastifyRequest<{ Params: { id: string } }>) => {
        const gameId = request.params.id;
        const token = extractSubprotocolToken(request.headers['sec-websocket-protocol']);

        if (!token) {
          socket.close(1008, 'Missing token');
          return;
        }

        let payload: AccessClaims;
        try {
          payload = app.jwt.verify<AccessClaims>(token);
        } catch {
          socket.close(1008, 'Invalid token');
          return;
        }

        // Only the 15-minute access token may authenticate a connection.
        // Demanding a positive `access` claim rather than denying `refresh`
        // also fails closed on an unstamped token.
        if (payload.type !== ACCESS_TOKEN_TYPE || typeof payload.exp !== 'number') {
          socket.close(1008, 'Invalid token');
          return;
        }

        // Same live account read the REST guard does, so a disabled or deleted
        // account cannot open a socket with a token minted before the change.
        const [account] = await db
          .select({ disabled: schema.users.disabled })
          .from(schema.users)
          .where(eq(schema.users.id, payload.id))
          .limit(1);

        if (!account || account.disabled) {
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
        expiryOf.set(socket, payload.exp);
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
            const parsed = clientFrameSchema.safeParse(JSON.parse(raw.toString()));
            if (!parsed.success) {
              closeSocket(socket, 'Invalid frame');
              return;
            }
            const entry = registry.getEntry(gameId, socket);
            if (!entry) return;
            // Replace, not append: the client sends the full active set on
            // every change, and additive merging would broadcast forever
            // to symbols the user has dropped (e.g. when switching lists).
            entry.subscriptions.clear();
            for (const symbol of parsed.data.data.symbols) {
              entry.subscriptions.add(symbol.toUpperCase());
            }
          } catch {
            // Unparseable JSON. Same disposition as a schema failure — no
            // legitimate client sends one, and answering nothing lets a peer
            // keep probing for free.
            closeSocket(socket, 'Invalid frame');
          }
        });

        const cleanup = () => registry.remove(gameId, socket);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
      },
    );
  };
}
