import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { schema } from '../../src/db/index.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

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
      name: 'Achievement Replay Test Game',
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

/**
 * Waits for an `achievement_unlocked` event on the socket, rejecting on timeout.
 */
function waitForAchievementUnlocked(ws: WebSocket, ms = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for achievement_unlocked')), ms);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as { event: string };
      if (msg.event === 'achievement_unlocked') {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

/**
 * Asserts that NO `achievement_unlocked` event arrives within the given window.
 * Resolves if the window expires cleanly; rejects immediately if the event fires.
 */
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

describe('WS connect-time achievement replay', () => {
  let app: FastifyInstance;
  let port: number;
  let db: Db;
  let token: string;
  let gameId: string;
  let gamePlayerId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 150 });
    db = await createTestDb();
    app = await buildApp({ db, provider, logger: false, disablePoller: true, leaderboardThrottleMs: 0 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;

    ({ token } = await registerUser(app, 'replayuser1'));
    ({ id: gameId } = await createActiveGame(app, token));

    // There is exactly one game_players row for this game (the creator)
    const [row] = await db
      .select({ id: schema.gamePlayers.id })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .limit(1);
    gamePlayerId = row!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('replays an unacked unlock for the connecting player (replayed: true)', async () => {
    const unlockedAt = '2026-05-20T10:00:00.000Z';

    // Seed a completed achievement_progress row directly — bypassing the engine
    // so we don't need to fire a real trade event.
    await db.insert(schema.achievementProgress).values({
      gameId,
      gamePlayerId,
      achievementKey: 'first-trade',
      progress: 1,
      target: 1,
      unlockedAt,
    });

    // Ensure lastSeenUnlockAt is null (the default) so the unlock is "unacked"
    await db
      .update(schema.gamePlayers)
      .set({ lastSeenUnlockAt: null })
      .where(eq(schema.gamePlayers.id, gamePlayerId));

    const ws = connectWs(port, gameId, token);
    // Set up the message listener BEFORE waiting for open to avoid any race
    // between the open event and the server's async replay sending the message.
    const msgPromise = waitForAchievementUnlocked(ws, 3000);
    await waitForOpen(ws);

    const msg = await msgPromise as {
      event: string;
      data: {
        gamePlayerId: string;
        achievementKey: string;
        name: string;
        replayed: boolean;
        unlockedAt: string;
      };
    };

    expect(msg.event).toBe('achievement_unlocked');
    expect(msg.data.achievementKey).toBe('first-trade');
    expect(msg.data.gamePlayerId).toBe(gamePlayerId);
    expect(msg.data.name).toBe('First Trade');
    expect(msg.data.replayed).toBe(true);
    expect(msg.data.unlockedAt).toBe(unlockedAt);

    ws.close();
    await waitForClose(ws);
  });

  it('does NOT replay an unlock whose unlockedAt <= lastSeenUnlockAt (already acked)', async () => {
    const unlockedAt = '2026-05-20T10:00:00.000Z';
    // Advance lastSeenUnlockAt to the unlock time — player has already seen it
    await db
      .update(schema.gamePlayers)
      .set({ lastSeenUnlockAt: unlockedAt })
      .where(eq(schema.gamePlayers.id, gamePlayerId));

    const ws = connectWs(port, gameId, token);
    await waitForOpen(ws);

    // No achievement_unlocked should arrive within 400ms
    await expectNoAchievementUnlocked(ws, 400);

    ws.close();
    await waitForClose(ws);
  });
});
