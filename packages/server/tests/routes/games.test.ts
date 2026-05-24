import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';

async function registerUser(
  app: FastifyInstance,
  username: string,
): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createGame(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'Test Game',
      startDate: '2099-01-01T00:00:00.000Z',
      endDate: '2099-06-01T00:00:00.000Z',
      startingBalance: 10000,
      ...overrides,
    },
  });
}

// ─── POST /games ──────────────────────────────────────────────────────────────

describe('POST /games', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ token } = await registerUser(app, 'alice'));
  });
  afterAll(() => app.close());

  it('returns 201 with the created game', async () => {
    const res = await createGame(app, token);
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      id: string; name: string; status: string; startingBalance: number; createdBy: string;
    }>();
    expect(body.name).toBe('Test Game');
    expect(body.status).toBe('pending');
    expect(body.startingBalance).toBe(10000);
    expect(typeof body.id).toBe('string');
    expect(typeof body.createdBy).toBe('string');
  });

  it('auto-transitions status to active when startDate is in the past', async () => {
    const res = await createGame(app, token, {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ status: string }>().status).toBe('active');
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: { startDate: '2099-01-01T00:00:00.000Z', endDate: '2099-06-01T00:00:00.000Z', startingBalance: 10000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when endDate is before startDate', async () => {
    const res = await createGame(app, token, {
      startDate: '2099-06-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when startingBalance is zero', async () => {
    const res = await createGame(app, token, { startingBalance: 0 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when startingBalance is negative', async () => {
    const res = await createGame(app, token, { startingBalance: -100 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/games', payload: { name: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /games ───────────────────────────────────────────────────────────────

describe('GET /games', () => {
  let app: FastifyInstance;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    alice = await registerUser(app, 'alice2');
    bob = await registerUser(app, 'bob2');
  });
  afterAll(() => app.close());

  it('returns empty array when user has no games', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns only games the user participates in', async () => {
    await createGame(app, alice.token, { name: 'Alice Game' });
    await createGame(app, bob.token, { name: 'Bob Game' });

    const res = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(200);
    const games = res.json<Array<{ name: string }>>();
    expect(games).toHaveLength(1);
    expect(games[0]!.name).toBe('Alice Game');
  });

  it('recomputes status to active for a game with past startDate', async () => {
    await createGame(app, alice.token, {
      name: 'Past Start',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    const games = res.json<Array<{ name: string; status: string }>>();
    const past = games.find(g => g.name === 'Past Start');
    expect(past?.status).toBe('active');
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/games' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /games/:id/join ─────────────────────────────────────────────────────

describe('POST /games/:id/join', () => {
  let app: FastifyInstance;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    alice = await registerUser(app, 'alice3');
    bob = await registerUser(app, 'bob3');
  });
  afterAll(() => app.close());

  it('returns 201 with player info when joining', async () => {
    const gameRes = await createGame(app, alice.token, { startingBalance: 5000 });
    const gameId = gameRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ playerId: string; gameId: string; cashBalance: number; joinedAt: string }>();
    expect(body.gameId).toBe(gameId);
    expect(body.cashBalance).toBe(5000);
    expect(typeof body.playerId).toBe('string');
    expect(typeof body.joinedAt).toBe('string');
  });

  it('returns 409 when joining the same game twice', async () => {
    const gameRes = await createGame(app, alice.token);
    const gameId = gameRes.json<{ id: string }>().id;

    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 409 when joining an ended game', async () => {
    const gameRes = await createGame(app, alice.token, {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-02T00:00:00.000Z',
    });
    const gameId = gameRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for a nonexistent game', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games/00000000-0000-0000-0000-000000000000/join',
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/games/any-id/join' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /games/:id ───────────────────────────────────────────────────────────

describe('GET /games/:id', () => {
  let app: FastifyInstance;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };
  let carol: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    alice = await registerUser(app, 'alice4');
    bob = await registerUser(app, 'bob4');
    carol = await registerUser(app, 'carol4');
  });
  afterAll(() => app.close());

  it('returns game details with leaderboard for a participant', async () => {
    const gameRes = await createGame(app, alice.token, { startingBalance: 10000 });
    const gameId = gameRes.json<{ id: string }>().id;

    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}`,
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      id: string;
      viewerGamePlayerId: string | null;
      leaderboard: Array<{ rank: number; playerId: string; username: string; totalValue: number; cashBalance: number }>;
    }>();
    expect(body.id).toBe(gameId);
    expect(typeof body.viewerGamePlayerId).toBe('string');
    expect(body.leaderboard).toHaveLength(2);
    expect(body.leaderboard[0]!.rank).toBe(1);
    expect(body.leaderboard[0]!.totalValue).toBe(10000);
  });

  it('returns leaderboard sorted by totalValue descending', async () => {
    const gameRes = await createGame(app, alice.token, { startingBalance: 10000 });
    const gameId = gameRes.json<{ id: string }>().id;
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}`,
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    const { leaderboard } = res.json<{ leaderboard: Array<{ rank: number; totalValue: number }> }>();
    for (let i = 1; i < leaderboard.length; i++) {
      const prev = leaderboard[i - 1]!;
      const curr = leaderboard[i]!;
      expect(prev.totalValue).toBeGreaterThanOrEqual(curr.totalValue);
      expect(prev.rank).toBeLessThan(curr.rank);
    }
  });

  it('returns 404 when the calling user is not a participant', async () => {
    const gameRes = await createGame(app, alice.token);
    const gameId = gameRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}`,
      headers: { Authorization: `Bearer ${carol.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a nonexistent game', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/games/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/games/some-id' });
    expect(res.statusCode).toBe(401);
  });
});
