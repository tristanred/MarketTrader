import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import { buildApp } from '../../src/app.js';
import { createTestDb, registerAdmin } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { registerWebsocket } from '../../src/plugins/websocket.js';
import { registerJwt } from '../../src/plugins/jwt.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { GlobalClientRegistry } from '../../src/ws/global-registry.js';
import { liveRoute } from '../../src/ws/live-route.js';
import { globalLiveRoute } from '../../src/ws/global-live-route.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import { WS_AUTH_SUBPROTOCOL } from '../../src/ws/subprotocol.js';
import { WS_LIMIT_EXCEEDED_CLOSE_CODE } from '../../src/ws/close-codes.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { createLimits } from '../../src/limits/index.js';
import type { Db } from '../../src/db/index.js';

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function waitForClose(ws: WebSocket, ms = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS close timeout')), ms);
    ws.once('close', (code) => { clearTimeout(t); resolve(code); });
  });
}

function waitForEvent(ws: WebSocket, eventName: string, ms = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${eventName}`)), ms);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as { event: string };
      if (msg.event === eventName) {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('WebSocket limits', () => {
  let restApp: FastifyInstance;
  let wsApp: FastifyInstance;
  let db: Db;
  let registry: GameClientRegistry;
  let globalRegistry: GlobalClientRegistry;
  let port: number;

  beforeAll(async () => {
    db = await createTestDb();
    // Mints fixtures over the real routes with limits off; never listens.
    restApp = await buildApp({
      logger: false,
      db,
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: true,
      leaderboardThrottleMs: 0,
      limits: { disabled: true },
    });

    const config = RuntimeConfig.fromEnvironment({
      LIMIT_WS_CONNECTIONS_PER_USER: 2,
      LIMIT_WS_SUBSCRIBES_PER_MINUTE: 2,
      LIMITS_PROBATION_PERCENT: 100,
    });
    const limits = createLimits({ db, config });

    wsApp = Fastify({ logger: false });
    await registerWebsocket(wsApp);
    await registerJwt(wsApp, db);
    registry = new GameClientRegistry();
    globalRegistry = new GlobalClientRegistry();
    const engine = new AchievementEngine(db, new EventBus(), registry, new SystemSettingsService(db), []);
    const wsLimits = {
      limits,
      config,
      countUserSockets: (userId: string) =>
        registry.countForUser(userId) + globalRegistry.countForUser(userId),
    };
    await wsApp.register(liveRoute(db, registry, engine, 3_600_000, wsLimits));
    await wsApp.register(globalLiveRoute(db, globalRegistry, 3_600_000, wsLimits));
    await wsApp.listen({ port: 0, host: '127.0.0.1' });
    port = (wsApp.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await wsApp.close();
    await restApp.close();
  });

  async function makePlayer(username: string, asAdmin = false) {
    let token: string;
    let userId: string;
    if (asAdmin) {
      ({ token, userId } = await registerAdmin(restApp, username));
    } else {
      const res = await restApp.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username, password: 'password123' },
      });
      const body = res.json<{ token: string; user: { id: string } }>();
      token = body.token;
      userId = body.user.id;
    }
    const created = await restApp.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: `Limits ${username}`,
        // Relative to now so the game is active whenever the suite runs and its
        // span stays well inside GAME_MAX_DURATION_DAYS.
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        startingBalance: 10000,
      },
    });
    const { id: gameId } = created.json<{ id: string }>();
    return { token, userId, gameId };
  }

  const gameSocket = (gameId: string, token: string) =>
    new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [WS_AUTH_SUBPROTOCOL, token]);
  const globalSocket = (token: string) =>
    new WebSocket(`ws://127.0.0.1:${port}/ws/live`, [WS_AUTH_SUBPROTOCOL, token]);

  it('refuses a connection past the per-user cap with 4429, counting both routes', async () => {
    const p = await makePlayer('ws-cap');
    const a = gameSocket(p.gameId, p.token);
    await waitForOpen(a);
    const b = globalSocket(p.token);
    await waitForOpen(b);

    const c = gameSocket(p.gameId, p.token);
    expect(await waitForClose(c)).toBe(WS_LIMIT_EXCEEDED_CLOSE_CODE);
    const d = globalSocket(p.token);
    expect(await waitForClose(d)).toBe(WS_LIMIT_EXCEEDED_CLOSE_CODE);

    // A freed slot is usable again.
    a.close();
    await waitForClose(a);
    await new Promise((r) => setTimeout(r, 20));
    const e = gameSocket(p.gameId, p.token);
    await waitForOpen(e);
    e.close();
    b.close();
    await Promise.all([waitForClose(e), waitForClose(b)]);
  });

  it('never caps an admin', async () => {
    const p = await makePlayer('ws-cap-admin', true);
    const sockets = [gameSocket(p.gameId, p.token), gameSocket(p.gameId, p.token), globalSocket(p.token)];
    await Promise.all(sockets.map((s) => waitForOpen(s)));
    for (const s of sockets) s.close();
    await Promise.all(sockets.map((s) => waitForClose(s)));
  });

  it('drops an over-limit subscribe, answers with an error frame, and keeps the previous set', async () => {
    const p = await makePlayer('ws-subscribe');
    const ws = gameSocket(p.gameId, p.token);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['AAPL'] } }));
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['MSFT'] } }));
    const error = waitForEvent(ws, 'error');
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['TSLA'] } }));

    expect(await error).toEqual({ event: 'error', data: { code: 'LIMIT_EXCEEDED', limit: 'wsSubscribes' } });
    const [entry] = [...registry.getClients(p.gameId).values()];
    expect([...entry!.subscriptions]).toEqual(['MSFT']);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await waitForClose(ws);
  });
});
