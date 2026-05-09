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
