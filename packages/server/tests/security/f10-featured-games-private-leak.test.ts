import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import type { FeaturedGame } from '@markettrader/shared';

const ACTIVE_WINDOW = {
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2099-01-01T00:00:00.000Z',
};

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return res.json<{ token: string }>().token;
}

async function createGame(
  app: FastifyInstance,
  token: string,
  name: string,
  visibility: 'public' | 'private',
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: { name, ...ACTIVE_WINDOW, startingBalance: 10000, visibility },
  });
  if (res.statusCode !== 201) throw new Error(`createGame failed: ${res.statusCode} ${res.body}`);
  return res.json<{ id: string; status: string }>().id;
}

describe('GET /public/featured-games hides private games', () => {
  let app: FastifyInstance;
  let privateId: string;
  let publicId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const token = await register(app, 'f10-organiser');
    privateId = await createGame(app, token, 'F10 Secret Tournament', 'private');
    publicId = await createGame(app, token, 'F10 Open Tournament', 'public');
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns public games but never the private one', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/featured-games' });
    expect(res.statusCode).toBe(200);
    const body = res.json<FeaturedGame[]>();

    expect(body.map((g) => g.id)).toContain(publicId);
    expect(body.map((g) => g.id)).not.toContain(privateId);
  });

  it('leaks neither the private game name nor its roster', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/featured-games' });
    const raw = res.body;

    expect(raw).not.toContain('F10 Secret Tournament');
    expect(raw).not.toContain(privateId);

    const body = res.json<FeaturedGame[]>();
    const secret = body.find((g) => g.name === 'F10 Secret Tournament');
    expect(secret).toBeUndefined();
  });
});
