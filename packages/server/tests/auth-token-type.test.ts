import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createTestApp, createTestAppWithDb } from './helpers/app.js';
import { schema } from '../src/db/index.js';

/**
 * The bearer credential is the 15-minute access token and nothing else. These
 * cover the two ways that can break: another token minted with the same key
 * being accepted (the refresh token), and a token outliving the account it
 * names.
 */
describe('REST bearer tokens — only a live access token authenticates', () => {
  let app: FastifyInstance;

  // The first registrant is bootstrapped into the admin group, so this account
  // reaches both guards: `authenticate` and `requireAdmin`.
  let adminToken: string;
  let adminRefreshToken: string;
  let adminId: string;

  async function register(username: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'password123' },
    });
    if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
    return {
      token: res.json<{ token: string }>().token,
      userId: res.json<{ user: { id: string } }>().user.id,
      refreshToken: res.cookies.find((c) => c.name === 'refreshToken')?.value ?? '',
    };
  }

  const getGames = (token: string) =>
    app.inject({ method: 'GET', url: '/games', headers: { Authorization: `Bearer ${token}` } });

  const getAdminUsers = (token: string) =>
    app.inject({ method: 'GET', url: '/admin/users', headers: { Authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await register('tokentype-admin');
    adminToken = admin.token;
    adminRefreshToken = admin.refreshToken;
    adminId = admin.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts the access token issued at register', async () => {
    expect((await getGames(adminToken)).statusCode).toBe(200);
    expect((await getAdminUsers(adminToken)).statusCode).toBe(200);
  });

  it('rejects the refresh token replayed as a bearer token', async () => {
    expect(adminRefreshToken).not.toBe('');
    expect((await getGames(adminRefreshToken)).statusCode).toBe(401);
  });

  it('rejects the refresh token on admin routes too', async () => {
    expect((await getAdminUsers(adminRefreshToken)).statusCode).toBe(401);
  });

  it('rejects a token carrying no type claim', async () => {
    // Shape of every access token minted before the type claim existed.
    const untyped = app.jwt.sign({ id: adminId, username: 'tokentype-admin' }, { expiresIn: '15m' });
    expect((await getGames(untyped)).statusCode).toBe(401);
    expect((await getAdminUsers(untyped)).statusCode).toBe(401);
  });
});

describe('REST bearer tokens — account kill-switch takes effect immediately', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestAppWithDb>>['db'];

  async function register(username: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'password123' },
    });
    if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
    const body = res.json<{ token: string; user: { id: string } }>();
    return { token: body.token, userId: body.user.id };
  }

  const getGames = (token: string) =>
    app.inject({ method: 'GET', url: '/games', headers: { Authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a still-valid access token once the user is disabled', async () => {
    const { token, userId } = await register('killswitch-disabled');
    expect((await getGames(token)).statusCode).toBe(200);

    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, userId));

    // Same unexpired token — the ban must not wait out its 15 minutes.
    expect((await getGames(token)).statusCode).toBe(401);
  });

  it('rejects a still-valid access token once the user is deleted', async () => {
    const { token, userId } = await register('killswitch-deleted');
    expect((await getGames(token)).statusCode).toBe(200);

    await db.delete(schema.users).where(eq(schema.users.id, userId));

    expect((await getGames(token)).statusCode).toBe(401);
  });
});
