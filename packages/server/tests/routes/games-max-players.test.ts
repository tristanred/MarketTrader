import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, registerAdmin } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

async function register(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

describe('GAME_MAX_PLAYERS', () => {
  let app: FastifyInstance;
  let gameId: string;

  beforeAll(async () => {
    app = await createTestApp(undefined, undefined, {
      runtimeConfig: RuntimeConfig.fromEnvironment({ GAME_MAX_PLAYERS: 2 }),
    });
    const owner = await register(app, 'cap-owner');
    const res = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        name: 'Two Seats',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2099-01-01T00:00:00.000Z',
        startingBalance: 10_000,
      },
    });
    gameId = res.json<{ id: string }>().id;
  });
  afterAll(() => app.close());

  function join(token: string) {
    return app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it('lets players join up to the cap (the creator holds the first seat)', async () => {
    const second = await register(app, 'cap-second');
    expect((await join(second.token)).statusCode).toBe(201);
  });

  it('refuses the next join with 409 GAME_FULL', async () => {
    const third = await register(app, 'cap-third');
    const res = await join(third.token);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Game is full', code: 'GAME_FULL' });
  });

  it('still lets an admin seat a player past the cap', async () => {
    const admin = await registerAdmin(app, 'cap-admin');
    const fourth = await register(app, 'cap-fourth');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players`,
      headers: { Authorization: `Bearer ${admin.token}` },
      payload: { userId: fourth.userId },
    });
    expect(res.statusCode).toBe(201);
  });
});
