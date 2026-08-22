import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { GlobalClientRegistry } from './global-registry.js';
import { ACCESS_TOKEN_TYPE } from '../plugins/jwt.js';
import { extractSubprotocolToken } from './subprotocol.js';
import { WS_POLICY_CLOSE_CODE } from './close-codes.js';
import { env } from '../env.js';

/** Claims read off the upgrade credential. `exp` is seconds since the epoch. */
interface AccessClaims {
  id: string;
  username: string;
  type?: string;
  exp?: number;
}

/** Per-socket identity captured at upgrade, re-checked by the sweep below. */
interface SocketIdentity {
  userId: string;
  /** Token expiry, seconds since the epoch. */
  expiresAt: number;
}

function closeSocket(socket: WebSocket, reason: string): void {
  try {
    // Every close on this route is a credential decision — it accepts no
    // client frames, so it has no frame-validation code to distinguish.
    socket.close(WS_POLICY_CLOSE_CODE, reason);
  } catch {
    // Already closing or closed — nothing to revoke.
  }
}

/**
 * Closes any global socket whose token has expired or whose account has since
 * been disabled or deleted. Mirrors the per-game sweep in `live-route.ts`;
 * without it a 15-minute credential becomes an unbounded session.
 */
async function revalidateSockets(
  db: Db,
  registry: GlobalClientRegistry,
  identityOf: WeakMap<WebSocket, SocketIdentity>,
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Snapshot before the first await: a close landing mid-query mutates the
  // registry's map, and iterating it live would throw or skip entries.
  const sockets = [...registry.sockets()];
  const live: Array<[WebSocket, SocketIdentity]> = [];

  for (const socket of sockets) {
    const identity = identityOf.get(socket);
    if (!identity || identity.expiresAt <= nowSeconds) {
      closeSocket(socket, 'Token expired');
      continue;
    }
    live.push([socket, identity]);
  }

  if (live.length === 0) return;

  const userIds = [...new Set(live.map(([, identity]) => identity.userId))];
  const rows = await db
    .select({ id: schema.users.id, disabled: schema.users.disabled })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));

  const stillAuthorized = new Set(rows.filter((row) => !row.disabled).map((row) => row.id));

  for (const [socket, identity] of live) {
    if (!stillAuthorized.has(identity.userId)) {
      closeSocket(socket, 'Authorization revoked');
    }
  }
}

/**
 * Registers `/ws/live` — a global authenticated socket used for app-wide
 * chrome data (indices, ticker-tape config). Distinct from
 * `/games/:id/live` which is game-scoped.
 *
 * Auth: the access token is offered in the `Sec-WebSocket-Protocol` header,
 * same shape as the per-game socket — see {@link extractSubprotocolToken}.
 * Admitted sockets are re-checked on the interval below.
 *
 * @param revalidateIntervalMs - Overrides `WS_REVALIDATE_INTERVAL_MS`; tests
 *   pass a small value to observe a sweep without waiting.
 */
export function globalLiveRoute(
  db: Db,
  registry: GlobalClientRegistry,
  revalidateIntervalMs: number = env.WS_REVALIDATE_INTERVAL_MS,
) {
  return async function (app: FastifyInstance): Promise<void> {
    // WeakMap rather than a plain Map: a socket that vanishes without firing
    // `close` cannot leak an entry here.
    const identityOf = new WeakMap<WebSocket, SocketIdentity>();

    const sweep = setInterval(() => {
      // Fails open, same trade-off as the per-game sweep: a database blip must
      // not mass-disconnect every live session, at the price of a persistent
      // fault extending the revocation window for as long as it lasts.
      void revalidateSockets(db, registry, identityOf).catch((err: unknown) => {
        app.log.error({ err }, 'global ws revalidation sweep failed');
      });
    }, revalidateIntervalMs);
    // Never hold the process open: this timer runs for the lifetime of the app.
    sweep.unref?.();
    app.addHook('onClose', async () => {
      clearInterval(sweep);
    });

    app.get(
      '/ws/live',
      // otel:false — see the note in live-route.ts; the upgrade is long-lived.
      {
        websocket: true,
        config: { rateLimit: { max: 20, timeWindow: '1 minute' }, otel: false },
      },
      async (socket, request: FastifyRequest) => {
        const token = extractSubprotocolToken(request.headers['sec-websocket-protocol']);
        if (!token) {
          socket.close(WS_POLICY_CLOSE_CODE, 'Missing token');
          return;
        }
        let payload: AccessClaims;
        try {
          payload = app.jwt.verify<AccessClaims>(token);
        } catch {
          socket.close(WS_POLICY_CLOSE_CODE, 'Invalid token');
          return;
        }
        // Only the 15-minute access token may authenticate a connection.
        // Demanding a positive `access` claim rather than denying `refresh`
        // also fails closed on an unstamped token.
        if (payload.type !== ACCESS_TOKEN_TYPE || typeof payload.exp !== 'number') {
          socket.close(WS_POLICY_CLOSE_CODE, 'Invalid token');
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
          socket.close(WS_POLICY_CLOSE_CODE, 'Invalid token');
          return;
        }

        identityOf.set(socket, { userId: payload.id, expiresAt: payload.exp });
        registry.add(payload.id, socket);
        const cleanup = () => registry.remove(socket);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
      },
    );
  };
}
