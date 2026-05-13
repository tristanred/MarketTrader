import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from './helpers/app.js';

describe('POST /auth/register', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 201 with token and user on success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ token: string; user: { id: string; username: string } }>();
    expect(typeof body.token).toBe('string');
    expect(body.user.username).toBe('alice');
    expect(typeof body.user.id).toBe('string');
  });

  it('returns 409 when username is already taken', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'bob', password: 'password123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'bob', password: 'password456' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when username is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { password: 'password123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'carol', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('sets refreshToken HttpOnly cookie on register', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'fran', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    const refreshCookie = res.cookies.find((c) => c.name === 'refreshToken');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
  });

  it('refresh issued by register works against /auth/refresh and returns the new user', async () => {
    // Register user A, capture cookie.
    const regA = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'identityA', password: 'password123' },
    });
    const cookieA = regA.cookies.find((c) => c.name === 'refreshToken')?.value ?? '';
    expect(cookieA).not.toBe('');

    // Register user B *with user A's cookie in the jar*. The response must
    // contain a fresh cookie for B; using it on /auth/refresh must return B.
    const regB = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'identityB', password: 'password123' },
      cookies: { refreshToken: cookieA },
    });
    const cookieB = regB.cookies.find((c) => c.name === 'refreshToken')?.value ?? '';
    expect(cookieB).not.toBe('');
    expect(cookieB).not.toBe(cookieA);

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refreshToken: cookieB },
    });
    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.json<{ user: { username: string } }>().user.username).toBe('identityB');
  });
});

describe('POST /auth/login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    // seed a user
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'dave', password: 'password123' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with token and user on valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'dave', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; user: { id: string; username: string } }>();
    expect(typeof body.token).toBe('string');
    expect(body.user.username).toBe('dave');
  });

  it('sets refreshToken HttpOnly cookie on login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'dave', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const cookies = res.cookies;
    const refreshCookie = cookies.find((c) => c.name === 'refreshToken');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'dave', password: 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on unknown username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'nobody', password: 'password123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when body is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/refresh', () => {
  let app: FastifyInstance;
  let refreshCookieValue: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'eve', password: 'password123' },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'eve', password: 'password123' },
    });
    const cookie = loginRes.cookies.find((c) => c.name === 'refreshToken');
    refreshCookieValue = cookie?.value ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a new access token when refresh cookie is valid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refreshToken: refreshCookieValue },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; user: { id: string; username: string } }>();
    expect(typeof body.token).toBe('string');
    expect(body.user.username).toBe('eve');
  });

  it('returns 401 when refresh cookie is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when refresh cookie is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refreshToken: 'not.a.valid.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('clears the refreshToken cookie (Max-Age=0)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === 'refreshToken');
    expect(cleared).toBeDefined();
    // @fastify/cookie surfaces the cleared cookie with maxAge:0 + empty value.
    expect(cleared?.value).toBe('');
  });

  it('is idempotent — second call still returns 204', async () => {
    const res1 = await app.inject({ method: 'POST', url: '/auth/logout' });
    const res2 = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res1.statusCode).toBe(204);
    expect(res2.statusCode).toBe(204);
  });

  // Note: we intentionally do NOT test "logout then refresh with the old
  // cookie fails", because the JWT is stateless — server-side revocation is
  // out of scope (see plan, "Out of scope / follow-ups"). The real protection
  // is the browser dropping the cookie after the Set-Cookie clear; that's
  // covered by the first test above.
});
