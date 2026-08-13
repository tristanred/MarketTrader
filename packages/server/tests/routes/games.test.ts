import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createTestApp } from '../helpers/app.js';

async function registerUser(
  app: FastifyInstance,
  username: string,
): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createGame(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'Test Game',
      startDate: '2099-01-01T00:00:00.000Z',
      endDate: '2099-06-01T00:00:00.000Z',
      startingBalance: 10000,
      ...overrides,
    },
  });
}

function browseHas(res: LightMyRequestResponse, gameId: string): boolean {
  return res.json<{ id: string }[]>().some((g) => g.id === gameId);
}

// ─── POST /games ──────────────────────────────────────────────────────────────

describe('POST /games', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ token } = await registerUser(app, 'alice'));
  });
  afterAll(() => app.close());

  it('returns 201 with the created game', async () => {
    const res = await createGame(app, token);
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      id: string; name: string; status: string; startingBalance: number; createdBy: string;
    }>();
    expect(body.name).toBe('Test Game');
    expect(body.status).toBe('pending');
    expect(body.startingBalance).toBe(10000);
    expect(typeof body.id).toBe('string');
    expect(typeof body.createdBy).toBe('string');
  });

  it('auto-transitions status to active when startDate is in the past', async () => {
    const res = await createGame(app, token, {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ status: string }>().status).toBe('active');
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: { startDate: '2099-01-01T00:00:00.000Z', endDate: '2099-06-01T00:00:00.000Z', startingBalance: 10000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when endDate is before startDate', async () => {
    const res = await createGame(app, token, {
      startDate: '2099-06-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when startingBalance is zero', async () => {
    const res = await createGame(app, token, { startingBalance: 0 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when startingBalance is negative', async () => {
    const res = await createGame(app, token, { startingBalance: -100 });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/games', payload: { name: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('defaults visibility to public and mints an invite code', async () => {
    const res = await createGame(app, token);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ visibility: string; inviteCode: string }>();
    expect(body.visibility).toBe('public');
    expect(body.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/);
  });

  it('honours an explicit private visibility', async () => {
    const res = await createGame(app, token, { visibility: 'private' });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ visibility: string }>().visibility).toBe('private');
  });

  it('rejects an unknown visibility value', async () => {
    const res = await createGame(app, token, { visibility: 'secret' });
    expect(res.statusCode).toBe(400);
  });
});

// ─── GET /games ───────────────────────────────────────────────────────────────

describe('GET /games', () => {
  let app: FastifyInstance;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    alice = await registerUser(app, 'alice2');
    bob = await registerUser(app, 'bob2');
  });
  afterAll(() => app.close());

  it('returns empty array when user has no games', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns only games the user participates in', async () => {
    await createGame(app, alice.token, { name: 'Alice Game' });
    await createGame(app, bob.token, { name: 'Bob Game' });

    const res = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(200);
    const games = res.json<Array<{ name: string }>>();
    expect(games).toHaveLength(1);
    expect(games[0]!.name).toBe('Alice Game');
  });

  it('recomputes status to active for a game with past startDate', async () => {
    await createGame(app, alice.token, {
      name: 'Past Start',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/games',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    const games = res.json<Array<{ name: string; status: string }>>();
    const past = games.find(g => g.name === 'Past Start');
    expect(past?.status).toBe('active');
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/games' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /games/:id/join ─────────────────────────────────────────────────────

describe('POST /games/:id/join', () => {
  let app: FastifyInstance;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    alice = await registerUser(app, 'alice3');
    bob = await registerUser(app, 'bob3');
  });
  afterAll(() => app.close());

  it('returns 201 with player info when joining', async () => {
    const gameRes = await createGame(app, alice.token, { startingBalance: 5000 });
    const gameId = gameRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ playerId: string; gameId: string; cashBalance: number; joinedAt: string }>();
    expect(body.gameId).toBe(gameId);
    expect(body.cashBalance).toBe(5000);
    expect(typeof body.playerId).toBe('string');
    expect(typeof body.joinedAt).toBe('string');
  });

  it('returns 409 when joining the same game twice', async () => {
    const gameRes = await createGame(app, alice.token);
    const gameId = gameRes.json<{ id: string }>().id;

    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 409 when joining an ended game', async () => {
    const gameRes = await createGame(app, alice.token, {
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-02T00:00:00.000Z',
    });
    const gameId = gameRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for a nonexistent game', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games/00000000-0000-0000-0000-000000000000/join',
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/games/any-id/join' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /games/:id ───────────────────────────────────────────────────────────

describe('GET /games/:id', () => {
  let app: FastifyInstance;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };
  let carol: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    alice = await registerUser(app, 'alice4');
    bob = await registerUser(app, 'bob4');
    carol = await registerUser(app, 'carol4');
  });
  afterAll(() => app.close());

  it('returns game details with leaderboard for a participant', async () => {
    const gameRes = await createGame(app, alice.token, { startingBalance: 10000 });
    const gameId = gameRes.json<{ id: string }>().id;

    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}`,
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      id: string;
      viewerGamePlayerId: string | null;
      leaderboard: Array<{ rank: number; playerId: string; username: string; totalValue: number; cashBalance: number }>;
    }>();
    expect(body.id).toBe(gameId);
    expect(typeof body.viewerGamePlayerId).toBe('string');
    expect(body.leaderboard).toHaveLength(2);
    expect(body.leaderboard[0]!.rank).toBe(1);
    expect(body.leaderboard[0]!.totalValue).toBe(10000);
  });

  it('returns leaderboard sorted by totalValue descending', async () => {
    const gameRes = await createGame(app, alice.token, { startingBalance: 10000 });
    const gameId = gameRes.json<{ id: string }>().id;
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${bob.token}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}`,
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    const { leaderboard } = res.json<{ leaderboard: Array<{ rank: number; totalValue: number }> }>();
    for (let i = 1; i < leaderboard.length; i++) {
      const prev = leaderboard[i - 1]!;
      const curr = leaderboard[i]!;
      expect(prev.totalValue).toBeGreaterThanOrEqual(curr.totalValue);
      expect(prev.rank).toBeLessThan(curr.rank);
    }
  });

  it('returns 404 when the calling user is not a participant', async () => {
    const gameRes = await createGame(app, alice.token);
    const gameId = gameRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: 'GET',
      url: `/games/${gameId}`,
      headers: { Authorization: `Bearer ${carol.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a nonexistent game', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/games/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/games/some-id' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /games/browse ────────────────────────────────────────────────────────

describe('GET /games/browse', () => {
  let app: FastifyInstance;
  let owner: { token: string; userId: string };
  let browser: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerUser(app, 'browse-owner');
    browser = await registerUser(app, 'browse-visitor');
  });
  afterAll(() => app.close());

  function browse(token: string) {
    return app.inject({
      method: 'GET',
      url: '/games/browse',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/games/browse' });
    expect(res.statusCode).toBe(401);
  });

  it('lists a public game the caller has not joined, with counts and creator', async () => {
    const created = await createGame(app, owner.token, { name: 'Open Tournament' });
    const gameId = created.json<{ id: string }>().id;

    const res = await browse(browser.token);
    expect(res.statusCode).toBe(200);
    const row = res.json<
      { id: string; name: string; playerCount: number; createdByUsername: string }[]
    >().find((g) => g.id === gameId);

    expect(row).toBeDefined();
    expect(row?.name).toBe('Open Tournament');
    expect(row?.playerCount).toBe(1);
    expect(row?.createdByUsername).toBe('browse-owner');
  });

  it('never exposes the invite code', async () => {
    await createGame(app, owner.token, { name: 'No Code Leak' });
    const res = await browse(browser.token);
    for (const row of res.json<Record<string, unknown>[]>()) {
      expect(row).not.toHaveProperty('inviteCode');
    }
  });

  it("excludes the caller's own games", async () => {
    const created = await createGame(app, owner.token, { name: 'Owned' });
    const gameId = created.json<{ id: string }>().id;

    const res = await browse(owner.token);
    expect(browseHas(res, gameId)).toBe(false);
  });

  it('excludes a game once the caller joins it', async () => {
    const created = await createGame(app, owner.token, { name: 'Joinable' });
    const gameId = created.json<{ id: string }>().id;

    expect(browseHas(await browse(browser.token), gameId)).toBe(true);

    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${browser.token}` },
    });

    expect(browseHas(await browse(browser.token), gameId)).toBe(false);
  });

  it('excludes private games', async () => {
    const created = await createGame(app, owner.token, {
      name: 'Hidden',
      visibility: 'private',
    });
    const gameId = created.json<{ id: string }>().id;

    expect(browseHas(await browse(browser.token), gameId)).toBe(false);
  });

  it('excludes ended games', async () => {
    const created = await createGame(app, owner.token, {
      name: 'Finished',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2020-06-01T00:00:00.000Z',
    });
    const gameId = created.json<{ id: string }>().id;

    expect(browseHas(await browse(browser.token), gameId)).toBe(false);
  });
});

// ─── PATCH /games/:id ─────────────────────────────────────────────────────────

describe('PATCH /games/:id', () => {
  let app: FastifyInstance;
  let owner: { token: string; userId: string };
  let outsider: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerUser(app, 'patch-owner');
    outsider = await registerUser(app, 'patch-outsider');
  });
  afterAll(() => app.close());

  async function newGame(): Promise<string> {
    const res = await createGame(app, owner.token, { name: 'Patchable' });
    return res.json<{ id: string }>().id;
  }

  function patch(id: string, token: string, body: unknown) {
    return app.inject({
      method: 'PATCH',
      url: `/games/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: body,
    });
  }

  it('lets the creator flip a game to private', async () => {
    const id = await newGame();
    const res = await patch(id, owner.token, { visibility: 'private' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ visibility: string }>().visibility).toBe('private');
  });

  it('removes the game from browse once it is private', async () => {
    const id = await newGame();
    await patch(id, owner.token, { visibility: 'private' });

    const res = await app.inject({
      method: 'GET',
      url: '/games/browse',
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    expect(browseHas(res, id)).toBe(false);
  });

  it('returns 403 when a non-creator tries to change visibility', async () => {
    const id = await newGame();
    const res = await patch(id, outsider.token, { visibility: 'private' });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for an unknown game', async () => {
    const res = await patch('does-not-exist', owner.token, { visibility: 'private' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for an invalid visibility value', async () => {
    const id = await newGame();
    const res = await patch(id, owner.token, { visibility: 'nope' });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Invite codes ─────────────────────────────────────────────────────────────

describe('invite codes', () => {
  let app: FastifyInstance;
  let owner: { token: string; userId: string };
  let friend: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerUser(app, 'code-owner');
    friend = await registerUser(app, 'code-friend');
  });
  afterAll(() => app.close());

  it('returns the existing code and is idempotent', async () => {
    const created = await createGame(app, owner.token, { name: 'Coded' });
    const { id, inviteCode } = created.json<{ id: string; inviteCode: string }>();

    const first = await app.inject({
      method: 'POST',
      url: `/games/${id}/invite-code`,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ inviteCode: string }>().inviteCode).toBe(inviteCode);

    const second = await app.inject({
      method: 'POST',
      url: `/games/${id}/invite-code`,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(second.json<{ inviteCode: string }>().inviteCode).toBe(inviteCode);
  });

  it('returns 404 when a non-member tries to mint', async () => {
    const created = await createGame(app, owner.token, { name: 'Private Mint' });
    const id = created.json<{ id: string }>().id;

    const res = await app.inject({
      method: 'POST',
      url: `/games/${id}/invite-code`,
      headers: { Authorization: `Bearer ${friend.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('resolves a code to a joinable game for a non-member', async () => {
    const created = await createGame(app, owner.token, {
      name: 'Findable',
      visibility: 'private',
    });
    const { id, inviteCode } = created.json<{ id: string; inviteCode: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/games/by-code/${inviteCode}`,
      headers: { Authorization: `Bearer ${friend.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      id: string; name: string; playerCount: number; createdByUsername: string; alreadyMember: boolean;
    }>();
    expect(body.id).toBe(id);
    expect(body.name).toBe('Findable');
    expect(body.playerCount).toBe(1);
    expect(body.createdByUsername).toBe('code-owner');
    expect(body.alreadyMember).toBe(false);
  });

  it('reports alreadyMember for the creator', async () => {
    const created = await createGame(app, owner.token, { name: 'Mine' });
    const inviteCode = created.json<{ inviteCode: string }>().inviteCode;

    const res = await app.inject({
      method: 'GET',
      url: `/games/by-code/${inviteCode}`,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(res.json<{ alreadyMember: boolean }>().alreadyMember).toBe(true);
  });

  it('is case-insensitive', async () => {
    const created = await createGame(app, owner.token, { name: 'Case Test' });
    const inviteCode = created.json<{ inviteCode: string }>().inviteCode;

    const res = await app.inject({
      method: 'GET',
      url: `/games/by-code/${inviteCode.toLowerCase()}`,
      headers: { Authorization: `Bearer ${friend.token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for an unknown code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/games/by-code/ZZZZZZZZ',
      headers: { Authorization: `Bearer ${friend.token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
