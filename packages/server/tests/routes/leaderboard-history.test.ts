import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import type { LeaderboardHistoryResponse } from '@markettrader/shared';

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string; user: { id: string } }>();
}

async function createGameAndJoin(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'History Test',
      startDate: '2099-01-01T00:00:00.000Z',
      endDate: '2099-06-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>();
}

describe('GET /games/:id/leaderboard/history', () => {
  let app: FastifyInstance;
  let aliceToken: string;
  let bobToken: string;
  let gameId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const alice = await registerUser(app, 'lh_alice');
    const bob = await registerUser(app, 'lh_bob');
    aliceToken = alice.token;
    bobToken = bob.token;
    const game = await createGameAndJoin(app, aliceToken);
    gameId = game.id;
  });
  afterAll(() => app.close());

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/leaderboard/history`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when caller is not a member (ID enumeration guard)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/leaderboard/history`,
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a non-existent game', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/does-not-exist/leaderboard/history`,
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with a series per roster player (empty points when no snapshots)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/leaderboard/history?range=all`,
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<LeaderboardHistoryResponse>();
    expect(body.range).toBe('all');
    expect(body.series).toHaveLength(1);
    expect(body.series[0]?.username).toBe('lh_alice');
    expect(body.series[0]?.points).toEqual([]);
  });

  it('defaults range to 5d when omitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/leaderboard/history`,
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<LeaderboardHistoryResponse>().range).toBe('5d');
  });

  it('rejects an invalid range with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/leaderboard/history?range=99d`,
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
