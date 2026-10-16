import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

const DAY = 86_400_000;

function window(startOffsetDays: number, durationDays: number) {
  const start = Date.now() + startOffsetDays * DAY;
  return {
    startDate: new Date(start).toISOString(),
    endDate: new Date(start + durationDays * DAY).toISOString(),
  };
}

describe('POST /games bounds', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp(undefined, undefined, {
      runtimeConfig: RuntimeConfig.fromEnvironment({
        GAME_MAX_STARTING_BALANCE: 10_000_000,
        GAME_MAX_DURATION_DAYS: 365,
        GAME_MAX_START_DELAY_DAYS: 90,
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'bounds-user', password: 'password123' },
    });
    token = res.json<{ token: string }>().token;
  });
  afterAll(() => app.close());

  function create(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Bounded', startingBalance: 100_000, ...window(1, 30), ...payload },
    });
  }

  it('creates a game inside every bound', async () => {
    expect((await create({})).statusCode).toBe(201);
  });

  it('rejects a starting balance above GAME_MAX_STARTING_BALANCE with 400', async () => {
    const res = await create({ startingBalance: 1e12 });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/startingBalance/);
  });

  it('rejects a game longer than GAME_MAX_DURATION_DAYS with 400', async () => {
    const res = await create(window(1, 400));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/365 days/);
  });

  it('rejects a start further out than GAME_MAX_START_DELAY_DAYS with 400', async () => {
    const res = await create(window(120, 10));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/90 days/);
  });

  it('creates no row for a rejected game', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
    });
    await create({ startingBalance: 1e12 });
    const after = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.json<unknown[]>()).toHaveLength(before.json<unknown[]>().length);
  });
});
