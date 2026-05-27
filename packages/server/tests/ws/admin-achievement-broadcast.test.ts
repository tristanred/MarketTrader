import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { schema } from '../../src/db/index.js';

// ─── helpers (mirror live-route-achievement-replay.test.ts) ───────────────────

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createActiveGame(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'Admin Broadcast Test Game',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>();
}

function connectWs(port: number, gameId: string, token: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live?token=${token}`);
}

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

function waitForAchievementUnlocked(ws: WebSocket, ms = 2000): Promise<{
  event: string;
  data: { gamePlayerId: string; achievementKey: string; unlockedAt: string; name: string };
}> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for achievement_unlocked')), ms);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as { event: string };
      if (msg.event === 'achievement_unlocked') {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(msg as never);
      }
    };
    ws.on('message', handler);
  });
}

function expectNoAchievementUnlocked(ws: WebSocket, ms = 400): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off('message', handler);
      resolve();
    }, ms);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as { event: string };
      if (msg.event === 'achievement_unlocked') {
        clearTimeout(t);
        ws.off('message', handler);
        reject(new Error('Unexpectedly received achievement_unlocked'));
      }
    };
    ws.on('message', handler);
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Admin achievement mutations broadcast WS events', () => {
  let app: FastifyInstance;
  let port: number;
  let db: Db;
  let adminToken: string;
  let gameId: string;
  let gamePlayerId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 150 });
    db = await createTestDb();
    app = await buildApp({ db, provider, logger: false, disablePoller: true, leaderboardThrottleMs: 0 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;

    // First-registered becomes admin.
    ({ token: adminToken } = await registerUser(app, 'admin-broadcast'));
    ({ id: gameId } = await createActiveGame(app, adminToken));

    const [row] = await db
      .select({ id: schema.gamePlayers.id })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .limit(1);
    gamePlayerId = row!.id;

    // Suppress connect-time replay frames so individual tests can assert
    // cleanly on broadcasts triggered by admin mutations.
    await db
      .update(schema.gamePlayers)
      .set({ lastSeenUnlockAt: '2099-01-01T00:00:00.000Z' })
      .where(eq(schema.gamePlayers.id, gamePlayerId));
  });

  afterAll(async () => { await app.close(); });

  it('force-unlock from locked broadcasts achievement_unlocked', async () => {
    const ws = connectWs(port, gameId, adminToken);
    await waitForOpen(ws);
    const msgPromise = waitForAchievementUnlocked(ws, 3000);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/first-trade/unlock`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);

    const msg = await msgPromise;
    expect(msg.data.achievementKey).toBe('first-trade');
    expect(msg.data.gamePlayerId).toBe(gamePlayerId);
    expect(msg.data.name).toBe('First Trade');

    ws.close();
    await waitForClose(ws);
  });

  it('re-unlock on an already-unlocked row does NOT broadcast and preserves unlockedAt', async () => {
    // First unlock to seed the row.
    const first = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/ten-buys/unlock`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(first.statusCode).toBe(200);
    const firstUnlockedAt = first.json<{ unlockedAt: string }>().unlockedAt;

    // Connect WS now (after the first unlock) so we don't see the first event.
    const ws = connectWs(port, gameId, adminToken);
    await waitForOpen(ws);

    // Second unlock should be a no-op for the broadcast and preserve unlockedAt.
    const second = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/ten-buys/unlock`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ unlockedAt: string }>().unlockedAt).toBe(firstUnlockedAt);

    await expectNoAchievementUnlocked(ws, 400);

    ws.close();
    await waitForClose(ws);
  });

  it('set-progress crossing the target broadcasts; below target does NOT', async () => {
    // Reset ten-buys to start from locked.
    await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/ten-buys/reset`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const ws = connectWs(port, gameId, adminToken);
    await waitForOpen(ws);

    // Below target: no broadcast.
    const below = await app.inject({
      method: 'PATCH',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/ten-buys`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { progress: 5 },
    });
    expect(below.statusCode).toBe(200);
    await expectNoAchievementUnlocked(ws, 200);

    // Crossing the target: broadcast fires.
    const msgPromise = waitForAchievementUnlocked(ws, 3000);
    const cross = await app.inject({
      method: 'PATCH',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/ten-buys`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { progress: 10 },
    });
    expect(cross.statusCode).toBe(200);

    const msg = await msgPromise;
    expect(msg.data.achievementKey).toBe('ten-buys');

    ws.close();
    await waitForClose(ws);
  });

  it('set-progress on an already-unlocked row preserves unlockedAt and does NOT re-broadcast', async () => {
    // Read the existing unlockedAt for ten-buys (was just unlocked above).
    const [seed] = await db
      .select({ unlockedAt: schema.achievementProgress.unlockedAt })
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
          eq(schema.achievementProgress.achievementKey, 'ten-buys'),
        ),
      )
      .limit(1);
    const originalUnlockedAt = seed!.unlockedAt!;
    expect(originalUnlockedAt).toBeTruthy();

    const ws = connectWs(port, gameId, adminToken);
    await waitForOpen(ws);

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/ten-buys`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { progress: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ unlockedAt: string }>().unlockedAt).toBe(originalUnlockedAt);

    await expectNoAchievementUnlocked(ws, 400);

    ws.close();
    await waitForClose(ws);
  });

  it('reset does NOT broadcast', async () => {
    const ws = connectWs(port, gameId, adminToken);
    await waitForOpen(ws);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players/${gamePlayerId}/achievements/ten-buys/reset`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);

    await expectNoAchievementUnlocked(ws, 400);

    ws.close();
    await waitForClose(ws);
  });
});
