import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { registerWebsocket } from '../../src/plugins/websocket.js';
import { registerJwt } from '../../src/plugins/jwt.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { liveRoute } from '../../src/ws/live-route.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import { WS_AUTH_SUBPROTOCOL } from '../../src/ws/subprotocol.js';
import type { Db } from '../../src/db/index.js';

/**
 * The upgrade handler registers the socket, then awaits the achievement-replay
 * SELECT. Anything the peer does inside that await — disconnecting, sending its
 * first `subscribe` — is lost unless the socket's listeners are already
 * attached, and a lost `close` leaks the registry entry permanently.
 *
 * The window is a microtask on in-memory SQLite, so these tests hold the replay
 * SELECT open explicitly and act on the socket while the handler is parked.
 */

/** Position of the replay SELECT in the upgrade handler's query sequence. */
const REPLAY_SELECT_INDEX = 3;

/** The Drizzle select chain the replay query builds, narrowed to what it calls. */
interface QueryStep extends PromiseLike<unknown> {
  from(arg: unknown): QueryStep;
  where(arg: unknown): QueryStep;
  orderBy(arg: unknown): QueryStep;
}

/**
 * Wraps a `db` so the upgrade handler's replay SELECT parks until released,
 * making the connect-time window wide enough to act inside.
 */
class ReplaySelectGate {
  private selects = 0;
  private held: Promise<void> | null = null;
  private releaseHeld: (() => void) | null = null;
  private reached: Promise<void> | null = null;
  private markReached: (() => void) | null = null;

  /** Arms the gate for the next upgrade; resets the per-connection query count. */
  arm(): void {
    this.selects = 0;
    this.held = new Promise<void>((resolve) => {
      this.releaseHeld = resolve;
    });
    this.reached = new Promise<void>((resolve) => {
      this.markReached = resolve;
    });
  }

  /** Resolves once the handler is parked on the gated SELECT. */
  async whenParked(timeoutMs = 2000): Promise<void> {
    if (!this.reached) throw new Error('gate was never armed');
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('replay SELECT never reached — has the query sequence changed?')),
        timeoutMs,
      );
    });
    try {
      await Promise.race([this.reached, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  release(): void {
    this.releaseHeld?.();
    this.held = null;
  }

  wrap(db: Db): Db {
    return new Proxy(db, {
      get: (target, prop) => {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop !== 'select' || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(target) : value;
        }
        const select = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]): unknown => {
          const builder = select.apply(target, args) as QueryStep;
          this.selects += 1;
          const gate = this.held;
          if (this.selects !== REPLAY_SELECT_INDEX || !gate) return builder;
          this.markReached?.();
          return gateQuery(builder, gate);
        };
      },
    });
  }
}

/** Defers only the `await`, so the chain still builds the real query. */
function gateQuery(builder: QueryStep, gate: Promise<void>): QueryStep {
  let step = builder;
  const gated: QueryStep = {
    from: (arg) => { step = step.from(arg); return gated; },
    where: (arg) => { step = step.where(arg); return gated; },
    orderBy: (arg) => { step = step.orderBy(arg); return gated; },
    then: (onFulfilled, onRejected) => gate.then(() => step.then(onFulfilled, onRejected)),
  };
  return gated;
}

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/** Resolves on the next occurrence of `event` on a socket, rejecting on timeout. */
function once(socket: WebSocket, event: 'close' | 'message', ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, () => { clearTimeout(t); resolve(); });
  });
}

describe('the connect-time replay window', () => {
  let restApp: FastifyInstance;
  let wsApp: FastifyInstance;
  let db: Db;
  let registry: GameClientRegistry;
  let gate: ReplaySelectGate;
  let port: number;

  beforeAll(async () => {
    db = await createTestDb();
    // Only used to mint fixtures over the real routes; it never listens.
    restApp = await buildApp({
      logger: false,
      db,
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: true,
      leaderboardThrottleMs: 0,
    });

    gate = new ReplaySelectGate();
    wsApp = Fastify({ logger: false });
    await registerWebsocket(wsApp);
    await registerJwt(wsApp, db);
    registry = new GameClientRegistry();
    const engine = new AchievementEngine(
      db,
      new EventBus(),
      registry,
      new SystemSettingsService(db),
      [],
    );
    // A sweep would issue its own SELECTs and throw the gate's count off; an
    // hour-long interval keeps it out of the way.
    await wsApp.register(liveRoute(gate.wrap(db), registry, engine, 3_600_000));
    await wsApp.listen({ port: 0, host: '127.0.0.1' });
    port = (wsApp.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await wsApp.close();
    await restApp.close();
  });

  async function makePlayer(username: string) {
    const registered = await restApp.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'password123' },
    });
    const { token } = registered.json<{ token: string }>();
    const created = await restApp.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: `Window ${username}`,
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2099-01-01T00:00:00.000Z',
        startingBalance: 10000,
      },
    });
    const { id: gameId } = created.json<{ id: string }>();
    return { token, gameId };
  }

  /** Opens a socket and parks the handler on the replay SELECT. */
  async function connectAndPark(gameId: string, token: string) {
    gate.arm();
    const client = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [
      WS_AUTH_SUBPROTOCOL,
      token,
    ]);
    await waitForOpen(client);
    await gate.whenParked();
    const [server] = [...registry.getClients(gameId).keys()];
    expect(server).toBeDefined();
    return { client, server: server! };
  }

  it('removes a socket that disconnects while the replay query is in flight', async () => {
    const player = await makePlayer('window-close');
    const { client, server } = await connectAndPark(player.gameId, player.token);

    const serverSawClose = once(server, 'close');
    client.close();
    await serverSawClose;
    gate.release();

    // A `close` that lands before the handler attaches its listeners fires
    // once and never again: the entry would sit in the registry for the life
    // of the process, drifting the wsClients gauge and giving the revalidation
    // sweep a zombie to re-process every interval.
    expect(registry.getClients(player.gameId).size).toBe(0);
  });

  it('applies a subscribe frame that arrives while the replay query is in flight', async () => {
    const player = await makePlayer('window-subscribe');
    const { client, server } = await connectAndPark(player.gameId, player.token);

    // The browser client sends its first subscribe from `onopen`, which lands
    // well inside this window; a dropped one leaves the socket receiving no
    // price updates until its symbol set happens to change.
    const serverSawFrame = once(server, 'message');
    client.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['AAPL'] } }));
    await serverSawFrame;
    gate.release();
    await new Promise((r) => setTimeout(r, 20));

    const entry = registry.getEntry(player.gameId, server);
    expect([...(entry?.subscriptions ?? [])]).toEqual(['AAPL']);

    client.close();
  });
});
