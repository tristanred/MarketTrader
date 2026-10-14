import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestAppWithDb } from '../helpers/app.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('live options reach their consumers', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;

  beforeAll(async () => {
    ({ app, config } = await createTestAppWithDb());
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'live-watchlist', password: 'password123' },
    });
    token = res.json<{ token: string }>().token;
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (name: string) =>
    app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
    });

  it('WATCHLIST_MAX_PER_USER applies to the next create, and clearing restores it', async () => {
    expect((await create('first')).statusCode).toBe(201);

    config.set('WATCHLIST_MAX_PER_USER', 1);
    const blocked = await create('second');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: string }>().error).toContain('(1 per user)');

    config.clear('WATCHLIST_MAX_PER_USER');
    expect((await create('second')).statusCode).toBe(201);
  });
});
