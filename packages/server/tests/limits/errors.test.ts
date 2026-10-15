import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { LimitExceededBody } from '@markettrader/shared';
import { createTestApp } from '../helpers/app.js';
import { LimitExceededError, limitMessage, statusFor } from '../../src/limits/errors.js';

describe('limit error handling', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    app.get('/__quota', async () => {
      throw new LimitExceededError(
        { key: 'gamesCreated', max: 3, basis: 'probation', privileged: false, probation: true },
        7200,
      );
    });
    app.get('/__concurrent', async () => {
      throw new LimitExceededError({ key: 'activeGamesOwned', max: 5, basis: 'base', privileged: false, probation: false });
    });
    app.get('/__other', async () => {
      throw app.httpErrors.badRequest('nope');
    });
    app.withTypeProvider<ZodTypeProvider>().get(
      '/__validated',
      { schema: { querystring: z.object({ n: z.coerce.number().int() }) } },
      async () => ({ ok: true }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a quota denial with 429, Retry-After and the shared body', async () => {
    const res = await app.inject({ method: 'GET', url: '/__quota' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('7200');
    expect(res.json<LimitExceededBody>()).toEqual({
      error: 'Game creation limit reached (3 per week)',
      code: 'LIMIT_EXCEEDED',
      limit: 'gamesCreated',
      max: 3,
      probation: true,
      maturityDays: 7,
      retryAfterSeconds: 7200,
    });
  });

  it('answers a concurrent denial with 409 and no Retry-After', async () => {
    const res = await app.inject({ method: 'GET', url: '/__concurrent' });
    expect(res.statusCode).toBe(409);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.json<LimitExceededBody>()).toEqual({
      error: 'Active games owned limit reached (5 at once)',
      code: 'LIMIT_EXCEEDED',
      limit: 'activeGamesOwned',
      max: 5,
      probation: false,
    });
  });

  it('leaves every other error to Fastify’s default handler', async () => {
    const res = await app.inject({ method: 'GET', url: '/__other' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'nope' });

    const invalid = await app.inject({ method: 'GET', url: '/__validated?n=abc' });
    expect(invalid.statusCode).toBe(400);
  });

  it('statusFor maps kinds', () => {
    expect(statusFor('rate')).toBe(429);
    expect(statusFor('quota')).toBe(429);
    expect(statusFor('ip')).toBe(429);
    expect(statusFor('concurrent')).toBe(409);
    expect(limitMessage('openOrders', 13)).toBe('Open order limit reached (13 per game)');
  });

  it('carries the HTTP status on the error so onError capture sees a 4xx', () => {
    const err = new LimitExceededError({ key: 'openOrders', max: 1, basis: 'base', privileged: false, probation: false });
    expect(err.statusCode).toBe(409);
    expect(new LimitExceededError({ key: 'trades', max: 1, basis: 'base', privileged: false, probation: false }).statusCode).toBe(429);
  });

  it('exposes the limits bundle on the app', () => {
    expect(app.limits.resolver.isDisabled()).toBe(true);
  });
});
