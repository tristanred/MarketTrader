import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';

describe('GET /market/status', () => {
  let app: FastifyInstance;
  let marketStatus: MockMarketStatusProvider;

  beforeEach(async () => {
    marketStatus = new MockMarketStatusProvider();
    app = await createTestApp(undefined, marketStatus);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 and the current MarketStatusResult', async () => {
    marketStatus.setResult({ state: 'REGULAR', asOf: '2026-05-12T14:00:00Z', source: 'static' });
    const res = await app.inject({ method: 'GET', url: '/market/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      state: 'REGULAR',
      asOf: '2026-05-12T14:00:00Z',
      source: 'static',
    });
  });

  it('returns 429 with Retry-After on RATE_LIMITED', async () => {
    marketStatus.setError('RATE_LIMITED');
    const res = await app.inject({ method: 'GET', url: '/market/status' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('returns 502 on PROVIDER_ERROR', async () => {
    marketStatus.setError('PROVIDER_ERROR');
    const res = await app.inject({ method: 'GET', url: '/market/status' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});
