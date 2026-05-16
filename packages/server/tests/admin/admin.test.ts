import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const body = res.json<{ token: string; user: { id: string; username: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function loginToken(app: FastifyInstance, username: string, password = 'password123') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode}`);
  return res.json<{ token: string }>().token;
}

// All admin tests run against a single shared app + db. The very first
// registered user (`admin0`) is the bootstrap admin; everyone else is
// unprivileged unless we explicitly promote them.
let app: FastifyInstance;
let adminToken: string;
let adminId: string;

beforeAll(async () => {
  app = await createTestApp();
  const admin = await registerUser(app, 'admin0');
  adminToken = admin.token;
  adminId = admin.userId;
});

afterAll(async () => {
  await app.close();
});

describe('admin auth bootstrap', () => {
  it('grants admin only to the first registered user', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(ok.statusCode).toBe(200);

    const second = await registerUser(app, 'plainUser1');
    const denied = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { Authorization: `Bearer ${second.token}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  it('blocks login for disabled users', async () => {
    const carol = await registerUser(app, 'carol');
    const disable = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${carol.userId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { disabled: true },
    });
    expect(disable.statusCode).toBe(204);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'carol', password: 'password123' },
    });
    expect(loginRes.statusCode).toBe(403);
  });
});

describe('admin destructive guards', () => {
  it('blocks self-delete', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${adminId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('self_action_blocked');
  });

  it('blocks deleting a user who owns a game (even with force)', async () => {
    const owner = await registerUser(app, 'gameowner');
    const game = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        name: 'Owned Game',
        startDate: '2099-01-01T00:00:00.000Z',
        endDate: '2099-06-01T00:00:00.000Z',
        startingBalance: 10000,
      },
    });
    expect(game.statusCode).toBe(201);

    const noForce = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${owner.userId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(noForce.statusCode).toBe(409);
    expect(noForce.json<{ error: string }>().error).toBe('has_dependents');

    const force = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${owner.userId}?force=true`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(force.statusCode).toBe(409);
  });

  it('blocks self-remove from admin group', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${adminId}/groups/admin`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('admin game ownership transfer', () => {
  it('transfers ownership and auto-enrols the new owner', async () => {
    const owner = await registerUser(app, 'transferOwner');
    const newOwner = await registerUser(app, 'transferNew');

    const createRes = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        name: 'Transferable',
        startDate: '2099-01-01T00:00:00.000Z',
        endDate: '2099-06-01T00:00:00.000Z',
        startingBalance: 5000,
      },
    });
    const gameId = createRes.json<{ id: string }>().id;

    const transfer = await app.inject({
      method: 'PATCH',
      url: `/admin/games/${gameId}/owner`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { newOwnerId: newOwner.userId },
    });
    expect(transfer.statusCode).toBe(204);

    const detail = await app.inject({
      method: 'GET',
      url: `/admin/games/${gameId}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = detail.json<{ createdBy: string; playerCount: number }>();
    expect(body.createdBy).toBe(newOwner.userId);
    expect(body.playerCount).toBe(2);

    // Original owner no longer owns a game → admin can delete them with force.
    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${owner.userId}?force=true`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(204);
  });
});

describe('admin portfolio editing + audit log', () => {
  it('sets cashBalance and records an audit entry', async () => {
    const owner = await registerUser(app, 'cashGameOwner');
    const target = await registerUser(app, 'cashTarget');

    const gameRes = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        name: 'Cash Test',
        startDate: '2099-01-01T00:00:00.000Z',
        endDate: '2099-06-01T00:00:00.000Z',
        startingBalance: 1000,
      },
    });
    const gameId = gameRes.json<{ id: string }>().id;

    // Use the admin enrol endpoint — it returns the gamePlayerId directly.
    const enrol = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { userId: target.userId },
    });
    expect(enrol.statusCode).toBe(201);
    const playerId = enrol.json<{ playerId: string }>().playerId;
    expect(playerId).toBeDefined();

    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/players/${playerId}/cash`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { cashBalance: 9999, reason: 'unit test' },
    });
    expect(patch.statusCode).toBe(204);

    const audit = await app.inject({
      method: 'GET',
      url: `/admin/audit?action=portfolio.update_cash`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json<{ entries: { action: string; targetId: string; after: { cashBalance: number } }[] }>();
    const entry = auditBody.entries.find((e) => e.targetId === playerId);
    expect(entry).toBeDefined();
    expect(entry!.after.cashBalance).toBe(9999);
  });
});

describe('admin game players + trades listing', () => {
  it('lists players in a game and lists/filters trades', async () => {
    const owner = await registerUser(app, 'adminListOwner');
    const playerA = await registerUser(app, 'adminListPlayerA');

    // Start date in the recent past so the game is `active` and trades are
    // accepted (the trading route recomputes status from dates regardless of
    // any admin-status override).
    const gameRes = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        name: 'List Test',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2099-06-01T00:00:00.000Z',
        startingBalance: 50000,
      },
    });
    const gameId = gameRes.json<{ id: string }>().id;

    const enrolA = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { userId: playerA.userId },
    });
    expect(enrolA.statusCode).toBe(201);

    // Admin should see both the owner and playerA via the players endpoint,
    // even though the admin themselves is not a member of this game.
    const playersRes = await app.inject({
      method: 'GET',
      url: `/admin/games/${gameId}/players`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(playersRes.statusCode).toBe(200);
    const players = playersRes.json<{ players: { userId: string }[] }>().players;
    const ids = players.map((p) => p.userId).sort();
    expect(ids).toEqual([owner.userId, playerA.userId].sort());

    // Trades list — initially empty.
    const empty = await app.inject({
      method: 'GET',
      url: `/admin/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<{ total: number }>().total).toBe(0);

    // Status filter is honored even when empty.
    const filtered = await app.inject({
      method: 'GET',
      url: `/admin/games/${gameId}/trades?status=executed`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(filtered.statusCode).toBe(200);

    // Place a real trade and assert the trades response carries username + userId.
    const place = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${playerA.token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    // Accept either 201 (executed) or 202 (queued pending) — mock provider behavior may vary.
    expect([201, 202]).toContain(place.statusCode);

    const withTrades = await app.inject({
      method: 'GET',
      url: `/admin/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(withTrades.statusCode).toBe(200);
    const body = withTrades.json<{
      trades: { userId: string; username: string }[];
      total: number;
    }>();
    expect(body.total).toBe(1);
    expect(body.trades[0]!.userId).toBe(playerA.userId);
    expect(body.trades[0]!.username).toBe('adminListPlayerA');

    // Non-admin cannot reach either endpoint.
    const denied1 = await app.inject({
      method: 'GET',
      url: `/admin/games/${gameId}/players`,
      headers: { Authorization: `Bearer ${playerA.token}` },
    });
    expect(denied1.statusCode).toBe(403);
    const denied2 = await app.inject({
      method: 'GET',
      url: `/admin/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${playerA.token}` },
    });
    expect(denied2.statusCode).toBe(403);
  });
});

describe('admin player portfolio read', () => {
  it('returns enriched portfolio for any player; 403 for non-admin', async () => {
    const owner = await registerUser(app, 'portfReadOwner');
    const target = await registerUser(app, 'portfReadTarget');

    const gameRes = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        name: 'Portf Read',
        startDate: '2099-01-01T00:00:00.000Z',
        endDate: '2099-06-01T00:00:00.000Z',
        startingBalance: 25000,
      },
    });
    const gameId = gameRes.json<{ id: string }>().id;

    const enrol = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { userId: target.userId },
    });
    const playerId = enrol.json<{ playerId: string }>().playerId;

    const ok = await app.inject({
      method: 'GET',
      url: `/admin/players/${playerId}/portfolio`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<{
      cashBalance: number;
      holdings: unknown[];
      totalValue: number;
      reservedValue: number;
    }>();
    expect(body.cashBalance).toBe(25000);
    expect(body.holdings.length).toBe(0);
    expect(body.totalValue).toBe(25000);
    expect(body.reservedValue).toBe(0);

    const notFound = await app.inject({
      method: 'GET',
      url: `/admin/players/00000000-0000-0000-0000-000000000000/portfolio`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(notFound.statusCode).toBe(404);

    const denied = await app.inject({
      method: 'GET',
      url: `/admin/players/${playerId}/portfolio`,
      headers: { Authorization: `Bearer ${target.token}` },
    });
    expect(denied.statusCode).toBe(403);
  });
});

void loginToken;

