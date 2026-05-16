import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
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

  it('broadcasts ticker_tape_config_changed on /ws/live after a successful PUT', async () => {
    // Reuse the main app fixture so we don't spin up a parallel in-memory
    // DB / event-emitter pair. We need to .listen() to expose a TCP port
    // for the WS client; the shared in-memory DB pattern means we can't
    // build a "fresh" app cheaply.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live?token=${adminToken}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    // Give the server's WS handler time to call registry.add (it runs
    // after the handshake completes, on the async route body).
    await new Promise((r) => setTimeout(r, 100));

    const messagePromise = new Promise<{ event: string; data: { symbols: string[] } }>(
      (resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no broadcast in 3s')), 3000);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString()) as { event: string };
          if (msg.event === 'ticker_tape_config_changed') {
            clearTimeout(t);
            resolve(msg as { event: string; data: { symbols: string[] } });
          }
        });
      },
    );

    await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: ['INTC', 'AMD'] },
    });

    const message = await messagePromise;
    expect(message.data.symbols).toEqual(['INTC', 'AMD']);
    ws.close();
  });
});
