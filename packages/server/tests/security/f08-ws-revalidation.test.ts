import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'net';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { schema } from '../../src/db/index.js';
import { registerWebsocket } from '../../src/plugins/websocket.js';
import { registerJwt, signAccessToken } from '../../src/plugins/jwt.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { GlobalClientRegistry } from '../../src/ws/global-registry.js';
import { liveRoute } from '../../src/ws/live-route.js';
import { globalLiveRoute } from '../../src/ws/global-live-route.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import { WS_AUTH_SUBPROTOCOL } from '../../src/ws/subprotocol.js';

/**
 * F8 — a live socket's authorization was decided once at upgrade and never
 * revisited, so a removed player, a disabled account and an expired token all
 * kept receiving the game's event stream for as long as the socket stayed open.
 *
 * The sockets here are served by a bare app wired with a 50 ms revalidation
 * interval, so a sweep is observable without waiting out the production one.
 */

const SWEEP_MS = 50;

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function waitForClose(ws: WebSocket, ms = 4000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS close timeout')), ms);
    ws.once('close', (code) => { clearTimeout(t); resolve(code); });
  });
}

/** Polls `predicate` until it holds or `ms` elapses. */
async function waitFor(predicate: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Resolves true when the socket survives `ms` without a close frame. */
function staysOpen(ws: WebSocket, ms = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms);
    ws.once('close', () => { clearTimeout(t); resolve(false); });
  });
}

describe('live sockets are re-authorized after upgrade (F8)', () => {
  let restApp: FastifyInstance;
  let wsApp: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let registry: GameClientRegistry;
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

    wsApp = Fastify({ logger: false });
    await registerWebsocket(wsApp);
    await registerJwt(wsApp, db);
    registry = new GameClientRegistry();
    const globalRegistry = new GlobalClientRegistry();
    const engine = new AchievementEngine(
      db,
      new EventBus(),
      registry,
      new SystemSettingsService(db),
      [],
    );
    await wsApp.register(liveRoute(db, registry, engine, SWEEP_MS));
    await wsApp.register(globalLiveRoute(db, globalRegistry, SWEEP_MS));
    await wsApp.listen({ port: 0, host: '127.0.0.1' });
    port = (wsApp.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await wsApp.close();
    await restApp.close();
  });

  /** Registers a user and enrols them in a fresh game they own. */
  async function makePlayer(username: string) {
    const registered = await restApp.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'password123' },
    });
    const { token, user } = registered.json<{ token: string; user: { id: string } }>();
    const created = await restApp.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: `F8 ${username}`,
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2099-01-01T00:00:00.000Z',
        startingBalance: 10000,
      },
    });
    const { id: gameId } = created.json<{ id: string }>();
    return { token, userId: user.id, username, gameId };
  }

  function connectGame(gameId: string, token: string): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [
      WS_AUTH_SUBPROTOCOL,
      token,
    ]);
  }

  it('keeps a still-authorized socket open across sweeps', async () => {
    const player = await makePlayer('f8-stable');
    const ws = connectGame(player.gameId, player.token);
    await waitForOpen(ws);
    expect(await staysOpen(ws, SWEEP_MS * 8)).toBe(true);
    ws.close();
    await waitForClose(ws);
  });

  it('closes a socket whose game membership has been revoked', async () => {
    const player = await makePlayer('f8-removed');
    const ws = connectGame(player.gameId, player.token);
    await waitForOpen(ws);

    await db.delete(schema.gamePlayers).where(eq(schema.gamePlayers.userId, player.userId));

    expect(await waitForClose(ws)).toBe(1008);
    // The client sees the close frame before the server's own `close` event
    // runs the registry cleanup, so settle before asserting the room emptied.
    await waitFor(() => registry.getClients(player.gameId).size === 0);
    expect(registry.getClients(player.gameId).size).toBe(0);
  });

  it('closes a socket whose account has been disabled', async () => {
    const player = await makePlayer('f8-disabled');
    const ws = connectGame(player.gameId, player.token);
    await waitForOpen(ws);

    await db
      .update(schema.users)
      .set({ disabled: true })
      .where(eq(schema.users.id, player.userId));

    expect(await waitForClose(ws)).toBe(1008);
  });

  it('closes a socket once its access token expires', async () => {
    const player = await makePlayer('f8-expiring');
    const shortLived = wsApp.jwt.sign(
      { id: player.userId, username: player.username, type: 'access' },
      { expiresIn: '1s' },
    );
    const ws = connectGame(player.gameId, shortLived);
    await waitForOpen(ws);
    expect(await waitForClose(ws)).toBe(1008);
  });

  it('refuses an upgrade from an already-disabled account', async () => {
    const player = await makePlayer('f8-predisabled');
    await db
      .update(schema.users)
      .set({ disabled: true })
      .where(eq(schema.users.id, player.userId));

    const ws = connectGame(player.gameId, player.token);
    expect(await waitForClose(ws)).toBe(1008);
  });

  it('closes a global socket whose account has been disabled', async () => {
    const player = await makePlayer('f8-global');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live`, [
      WS_AUTH_SUBPROTOCOL,
      player.token,
    ]);
    await waitForOpen(ws);

    await db
      .update(schema.users)
      .set({ disabled: true })
      .where(eq(schema.users.id, player.userId));

    expect(await waitForClose(ws)).toBe(1008);
  });

  it('does not leak the sweep timer past app close', async () => {
    const player = await makePlayer('f8-teardown');
    const local = Fastify({ logger: false });
    await registerWebsocket(local);
    await registerJwt(local, db);
    const localRegistry = new GameClientRegistry();
    const engine = new AchievementEngine(
      db,
      new EventBus(),
      localRegistry,
      new SystemSettingsService(db),
      [],
    );
    await local.register(liveRoute(db, localRegistry, engine, SWEEP_MS));
    await local.listen({ port: 0, host: '127.0.0.1' });
    const localPort = (local.server.address() as AddressInfo).port;

    const token = signAccessToken(local, { id: player.userId, username: player.username });
    const ws = new WebSocket(`ws://127.0.0.1:${localPort}/games/${player.gameId}/live`, [
      WS_AUTH_SUBPROTOCOL,
      token,
    ]);
    await waitForOpen(ws);
    await local.close();

    // A sweep that survived close would keep querying a torn-down app; the
    // socket must be gone and nothing must throw afterwards.
    await new Promise((r) => setTimeout(r, SWEEP_MS * 4));
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
