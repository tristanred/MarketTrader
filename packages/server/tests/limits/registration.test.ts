import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { LimitExceededBody } from '@markettrader/shared';
import { createTestAppWithDb } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestAppWithDb>>['db'];

describe('registrations per IP per day', () => {
  let app: FastifyInstance;
  let db: Db;
  let config: RuntimeConfig;
  let seq = 0;

  const register = (remoteAddress: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress,
      payload: { username: `reg-${++seq}`, password: 'password123' },
    });

  beforeAll(async () => {
    ({ app, db, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({ LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 2 }),
    }));
  });
  afterAll(() => app.close());
  afterEach(() => {
    config.clearAll();
  });

  it('stores the address the account registered from', async () => {
    const res = await register('198.51.100.10');
    expect(res.statusCode).toBe(201);
    const id = res.json<{ user: { id: string } }>().user.id;
    const [row] = await db
      .select({ ip: schema.users.registrationIp })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(row?.ip).toBe('198.51.100.10');
  });

  it('refuses the registration past the cap with a 429 and Retry-After', async () => {
    expect((await register('198.51.100.20')).statusCode).toBe(201);
    expect((await register('198.51.100.20')).statusCode).toBe(201);

    const over = await register('198.51.100.20');
    expect(over.statusCode).toBe(429);
    const body = over.json<LimitExceededBody>();
    expect(body).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'registrationsPerIp',
      max: 2,
      probation: false,
    });
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(86_400);
  });

  it('counts each address separately', async () => {
    await register('198.51.100.30');
    await register('198.51.100.30');
    expect((await register('198.51.100.31')).statusCode).toBe(201);
  });

  it('forgets registrations older than 24 hours', async () => {
    await register('198.51.100.40');
    await register('198.51.100.40');
    expect((await register('198.51.100.40')).statusCode).toBe(429);

    await db
      .update(schema.users)
      .set({ createdAt: '2000-01-01 00:00:00' })
      .where(eq(schema.users.registrationIp, '198.51.100.40'));

    expect((await register('198.51.100.40')).statusCode).toBe(201);
  });

  it('multiplies the cap for a privileged address', async () => {
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 3);
    for (let i = 0; i < 6; i += 1) {
      expect((await register('203.0.113.50')).statusCode).toBe(201);
    }
    expect((await register('203.0.113.50')).statusCode).toBe(429);
  });

  it('is lifted by LIMITS_ENABLED=false', async () => {
    config.set('LIMITS_ENABLED', false);
    for (let i = 0; i < 4; i += 1) {
      expect((await register('198.51.100.60')).statusCode).toBe(201);
    }
  });

  it('is checked before the username is claimed', async () => {
    await register('198.51.100.70');
    await register('198.51.100.70');
    const over = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: '198.51.100.70',
      payload: { username: 'never-created', password: 'password123' },
    });
    expect(over.statusCode).toBe(429);
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, 'never-created'));
    expect(row).toBeUndefined();
  });
});
