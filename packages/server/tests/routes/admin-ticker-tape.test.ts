import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';

describe('PUT /admin/system-settings/ticker-tape', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    // First-ever registrant becomes admin per existing repo convention.
    const reg1 = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'admin-tape', password: 'password123' },
    });
    adminToken = reg1.json<{ token: string }>().token;

    const reg2 = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'member-tape', password: 'password123' },
    });
    memberToken = reg2.json<{ token: string }>().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('updates the tape and returns the new config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: ['MSFT', 'AAPL', 'NVDA'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ symbols: string[]; updatedAt: string }>();
    expect(body.symbols).toEqual(['MSFT', 'AAPL', 'NVDA']);
    expect(body.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('uppercases and trims symbols before persisting', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: ['  tsla ', 'goog'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ symbols: string[] }>().symbols).toEqual(['TSLA', 'GOOG']);
  });

  it('rejects an empty list with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      payload: { symbols: ['AAPL'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects non-admin requests with 403', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { symbols: ['AAPL'] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes an audit-log row on success', async () => {
    // Use the shared app+adminToken; the shared in-memory DB means any fresh
    // createTestApp() would see the existing users and the audit-admin user
    // would not be first (and therefore not auto-promoted to admin).
    const put = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: ['AAPL', 'MSFT'] },
    });
    expect(put.statusCode).toBe(200);

    const audit = await app.inject({
      method: 'GET',
      url: '/admin/audit?limit=5',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(audit.statusCode).toBe(200);
    // Audit endpoint returns { entries: [...], total: N }
    const body = audit.json<{ entries: Array<{ action: string; targetType: string }> }>();
    const tapeRow = body.entries.find((r) => r.action === 'system.ticker_tape.update');
    expect(tapeRow).toBeDefined();
    expect(tapeRow!.targetType).toBe('system');
  });
});
