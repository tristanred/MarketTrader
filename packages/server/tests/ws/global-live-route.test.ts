import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string }>();
  return body.token;
}

function waitForClose(ws: WebSocket, ms = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS close timeout')), ms);
    ws.once('close', (code) => { clearTimeout(t); resolve(code); });
  });
}

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

describe('GET /ws/live (global socket)', () => {
  let app: FastifyInstance;
  let port: number;
  let token: string;

  beforeAll(async () => {
    const db = await createTestDb();
    app = await buildApp({
      logger: false,
      db,
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: true,
      leaderboardThrottleMs: 0,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    token = await registerUser(app, 'global-ws-user');
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects connections without a token (close 1008)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live`);
    const code = await waitForClose(ws);
    expect(code).toBe(1008);
  });

  it('rejects connections with an invalid token (close 1008)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live?token=garbage`);
    const code = await waitForClose(ws);
    expect(code).toBe(1008);
  });

  it('accepts a valid token and stays open', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live?token=${token}`);
    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
