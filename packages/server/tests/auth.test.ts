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
