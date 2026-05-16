import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';

describe('GET /system-settings/ticker-tape', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'tape-user', password: 'password123' },
    });
    const body = reg.json<{ token: string }>();
    token = body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the seeded default tape for any authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ symbols: string[]; updatedAt: string }>();
    expect(Array.isArray(body.symbols)).toBe(true);
    expect(body.symbols).toContain('^GSPC');
    expect(body.symbols).toContain('AAPL');
    expect(body.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/system-settings/ticker-tape' });
    expect(res.statusCode).toBe(401);
  });
});
