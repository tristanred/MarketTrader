import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { LimitExceededBody } from '@markettrader/shared';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { registerUser, ageAccount } from '../helpers/users.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestAppWithDb>>['db'];

const DAY_MS = 86_400_000;

function gamePayload(name: string) {
  const now = Date.now();
  return {
    name,
    startDate: new Date(now - 60_000).toISOString(),
    endDate: new Date(now + 7 * DAY_MS).toISOString(),
    startingBalance: 100_000,
  };
}

function createGame(app: FastifyInstance, token: string, name: string, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: gamePayload(name),
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}

function joinGame(app: FastifyInstance, token: string, gameId: string) {
  return app.inject({
    method: 'POST',
    url: `/games/${gameId}/join`,
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('game quotas', () => {
  let app: FastifyInstance;
  let db: Db;
  let config: RuntimeConfig;
  let seq = 0;
  const fresh = (prefix: string) => `${prefix}-${++seq}`;

  beforeAll(async () => {
    ({ app, db, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMIT_GAMES_CREATED_PER_WEEK: 2,
        LIMIT_ACTIVE_GAMES_OWNED: 100,
        LIMIT_GAMES_JOINED_PER_DAY: 100,
        LIMIT_ACTIVE_GAMES_JOINED: 100,
        LIMITS_PROBATION_PERCENT: 100,
        // Every account in this suite registers from the same inject IP.
        LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 1000,
      }),
    }));
  });
  afterAll(() => app.close());
  afterEach(() => {
    config.clearAll();
  });

  it('refuses the game past LIMIT_GAMES_CREATED_PER_WEEK with a 429 and Retry-After', async () => {
    const { token, userId } = await registerUser(app, fresh('creator'));
    // Mature, so the body reports the base value rather than a probation one.
    await ageAccount(db, userId, 30);
    expect((await createGame(app, token, 'g1')).statusCode).toBe(201);
    expect((await createGame(app, token, 'g2')).statusCode).toBe(201);

    const over = await createGame(app, token, 'g3');
    expect(over.statusCode).toBe(429);
    const body = over.json<LimitExceededBody>();
    expect(body).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'gamesCreated',
      max: 2,
      probation: false,
    });
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(7 * 86_400);
    expect(Number(over.headers['retry-after'])).toBe(body.retryAfterSeconds);
  });

  it('stops counting games once they fall outside the 7-day window', async () => {
    const { token, userId } = await registerUser(app, fresh('window'));
    await createGame(app, token, 'w1');
    await createGame(app, token, 'w2');
    expect((await createGame(app, token, 'w3')).statusCode).toBe(429);

    await db
      .update(schema.games)
      .set({ createdAt: '2000-01-01 00:00:00' })
      .where(eq(schema.games.createdBy, userId));

    expect((await createGame(app, token, 'w4')).statusCode).toBe(201);
  });

  it('caps games owned that have not ended with a 409', async () => {
    config.set('LIMIT_ACTIVE_GAMES_OWNED', 1);
    const { token } = await registerUser(app, fresh('owner'));
    expect((await createGame(app, token, 'o1')).statusCode).toBe(201);

    const over = await createGame(app, token, 'o2');
    expect(over.statusCode).toBe(409);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'activeGamesOwned', max: 1 });
  });

  it('frees an owned-game slot when that game ends', async () => {
    config.set('LIMIT_ACTIVE_GAMES_OWNED', 1);
    const { token, userId } = await registerUser(app, fresh('ender'));
    await createGame(app, token, 'e1');
    await db
      .update(schema.games)
      .set({ status: 'ended' })
      .where(eq(schema.games.createdBy, userId));

    expect((await createGame(app, token, 'e2')).statusCode).toBe(201);
  });

  it('caps active games joined, counting the creator seat', async () => {
    // The host creates three games; lift the suite's 2/week so the third is not refused by it.
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 10);
    const host = await registerUser(app, fresh('host'));
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await createGame(app, host.token, `j${i}`)).json<{ id: string }>().id);
    }
    // Lowered only now: the host's own creator seats count against it too.
    config.set('LIMIT_ACTIVE_GAMES_JOINED', 2);

    const player = await registerUser(app, fresh('joiner'));
    expect((await joinGame(app, player.token, ids[0]!)).statusCode).toBe(201);
    expect((await joinGame(app, player.token, ids[1]!)).statusCode).toBe(201);
    const over = await joinGame(app, player.token, ids[2]!);
    expect(over.statusCode).toBe(409);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'activeGamesJoined', max: 2 });

    // Creating a game seats the creator, so it is refused by the same cap.
    const created = await createGame(app, player.token, 'mine');
    expect(created.statusCode).toBe(409);
    expect(created.json<LimitExceededBody>().limit).toBe('activeGamesJoined');
  });

  it('caps games joined per day with a 429', async () => {
    const host = await registerUser(app, fresh('dayhost'));
    const a = (await createGame(app, host.token, 'd1')).json<{ id: string }>().id;
    const b = (await createGame(app, host.token, 'd2')).json<{ id: string }>().id;
    config.set('LIMIT_GAMES_JOINED_PER_DAY', 1);

    const player = await registerUser(app, fresh('dayjoiner'));
    expect((await joinGame(app, player.token, a)).statusCode).toBe(201);
    const over = await joinGame(app, player.token, b);
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'gamesJoined', max: 1 });
  });

  it('still reports "already joined" to a member who is at the cap', async () => {
    config.set('LIMIT_ACTIVE_GAMES_JOINED', 1);
    const host = await registerUser(app, fresh('dup-host'));
    const gameId = (await createGame(app, host.token, 'dup')).json<{ id: string }>().id;

    const res = await joinGame(app, host.token, gameId);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('Already joined this game');
  });

  it('exempts admins', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    const admin = await registerAdmin(app, fresh('quota-admin'));
    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, admin.token, `a${i}`)).statusCode).toBe(201);
    }
  });

  it('honours a per-user override over the global value', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    const admin = await registerAdmin(app, fresh('override-admin'));
    const user = await registerUser(app, fresh('overridden'));
    await app.limits.overrides.set(admin.userId, user.userId, 'gamesCreated', 3, 'quota test');

    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, user.token, `ov${i}`)).statusCode).toBe(201);
    }
    expect((await createGame(app, user.token, 'ov3')).statusCode).toBe(429);
  });

  it('puts new accounts on probation until they mature', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 4);
    config.set('LIMITS_PROBATION_PERCENT', 50);
    const user = await registerUser(app, fresh('rookie'));

    await createGame(app, user.token, 'r1');
    await createGame(app, user.token, 'r2');
    const over = await createGame(app, user.token, 'r3');
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>()).toMatchObject({ max: 2, probation: true });

    await ageAccount(db, user.userId, 30);
    expect((await createGame(app, user.token, 'r4')).statusCode).toBe(201);
  });

  it('multiplies the limit on a privileged connection', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 3);
    const user = await registerUser(app, fresh('office'));

    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, user.token, `p${i}`, '203.0.113.20')).statusCode).toBe(201);
    }
    expect((await createGame(app, user.token, 'p3', '203.0.113.20')).statusCode).toBe(429);
  });

  it('lifts every quota when LIMITS_ENABLED is false', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    config.set('LIMITS_ENABLED', false);
    const user = await registerUser(app, fresh('killswitch'));
    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, user.token, `k${i}`)).statusCode).toBe(201);
    }
  });

  // Review Focus #2: SQLite stores `created_at` as `YYYY-MM-DD HH:MM:SS` (UTC, no T/Z), so a
  // window boundary compared as an ISO string would be off by the 'T' vs ' ' sort order.
  it('counts a game created 6d23h ago and ignores one created 7d1h ago', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    const { token, userId } = await registerUser(app, fresh('boundary'));
    expect((await createGame(app, token, 'b1')).statusCode).toBe(201);
    const sqliteTime = (msAgo: number) =>
      new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
    const HOUR_MS = 3_600_000;

    await db
      .update(schema.games)
      .set({ createdAt: sqliteTime(7 * DAY_MS - HOUR_MS) })
      .where(eq(schema.games.createdBy, userId));
    expect((await createGame(app, token, 'b2')).statusCode).toBe(429);

    await db
      .update(schema.games)
      .set({ createdAt: sqliteTime(7 * DAY_MS + HOUR_MS) })
      .where(eq(schema.games.createdBy, userId));
    expect((await createGame(app, token, 'b3')).statusCode).toBe(201);
  });

  // Review Focus #4: an override below current usage must deny new creates without touching
  // existing rows.
  it('denies the next create when an override is lowered below current usage', async () => {
    // The suite boots with 2 creates/week; raise it so the 5 setup games are not refused by it.
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 10);
    config.set('LIMIT_ACTIVE_GAMES_OWNED', 10);
    const admin = await registerAdmin(app, fresh('lower-admin'));
    const user = await registerUser(app, fresh('lowered'));
    for (let i = 0; i < 5; i += 1) {
      expect((await createGame(app, user.token, `l${i}`)).statusCode).toBe(201);
    }
    // The app's own service: its per-user cache is already warm from the creates above.
    await app.limits.overrides.set(admin.userId, user.userId, 'activeGamesOwned', 2, 'lowered');

    const over = await createGame(app, user.token, 'l5');
    expect(over.statusCode).toBe(409);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'activeGamesOwned', max: 2 });
    const owned = await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.createdBy, user.userId));
    expect(owned).toHaveLength(5);
  });
});
