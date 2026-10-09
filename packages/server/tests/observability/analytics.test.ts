import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { EventBus } from '../../src/events/bus.js';
import { registerAnalytics } from '../../src/observability/analytics.js';
import type { AnalyticsClient } from '../../src/observability/posthog.js';
import type { Db } from '../../src/db/index.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';

/**
 * Server-side analytics is wired through the domain event bus, so these tests
 * drive the real routes and assert on what reached a fake PostHog client: the
 * distinct id must be `users.id` (what the browser identifies as), and the
 * events the client used to send must still carry the properties it sent.
 */

interface Captured {
  distinctId: string;
  event: string;
  properties?: Record<string | number, unknown>;
}

function fakeClient() {
  const captured: Captured[] = [];
  const client = {
    capture: vi.fn((msg: Captured) => {
      captured.push(msg);
    }),
    captureException: vi.fn(),
  };
  return { client: client as unknown as AnalyticsClient, captured };
}

function eventsNamed(captured: Captured[], name: string) {
  return captured.filter((c) => c.event === name);
}

async function register(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createGame(app: FastifyInstance, token: string, visibility: 'public' | 'private') {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      visibility,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>();
}

const uniq = () => `u-${Math.random().toString(36).slice(2, 10)}`;

describe('server-side analytics through the event bus', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let captured: Captured[];

  beforeAll(async () => {
    db = await createTestDb();
    const fake = fakeClient();
    captured = fake.captured;
    app = await buildApp({
      logger: false,
      db,
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: true,
      loginThrottle: { disabled: true },
      leaderboardThrottleMs: 0,
      analytics: fake.client,
    });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    captured.length = 0;
  });

  it('captures game creation and the creator joining, keyed by user id', async () => {
    const { token, userId } = await register(app, uniq());
    const game = await createGame(app, token, 'private');

    await vi.waitFor(() => expect(eventsNamed(captured, 'game_joined')).toHaveLength(1));
    expect(eventsNamed(captured, 'game_created')).toEqual([
      {
        distinctId: userId,
        event: 'game_created',
        properties: expect.objectContaining({
          game_id: game.id,
          visibility: 'private',
          environment: 'test',
        }),
      },
    ]);
    expect(eventsNamed(captured, 'game_joined')[0]).toMatchObject({
      distinctId: userId,
      properties: { game_id: game.id, join_source: 'creator' },
    });
  });

  it('tells an invite-code join apart from a public one', async () => {
    const owner = await register(app, uniq());
    const privateGame = await createGame(app, owner.token, 'private');
    const publicGame = await createGame(app, owner.token, 'public');
    const [row] = await db
      .select({ inviteCode: schema.games.inviteCode })
      .from(schema.games)
      .where(eq(schema.games.id, privateGame.id));

    const guest = await register(app, uniq());
    captured.length = 0;
    await app.inject({
      method: 'POST',
      url: `/games/${privateGame.id}/join`,
      headers: { Authorization: `Bearer ${guest.token}` },
      payload: { inviteCode: row?.inviteCode },
    });
    await app.inject({
      method: 'POST',
      url: `/games/${publicGame.id}/join`,
      headers: { Authorization: `Bearer ${guest.token}` },
    });

    await vi.waitFor(() => expect(eventsNamed(captured, 'game_joined')).toHaveLength(2));
    const sources = Object.fromEntries(
      eventsNamed(captured, 'game_joined').map((c) => [c.properties?.['game_id'], c.properties?.['join_source']]),
    );
    expect(sources).toEqual({ [privateGame.id]: 'invite_code', [publicGame.id]: 'public' });
  });

  it('captures an executed trade and the achievement it unlocks against the player', async () => {
    const { token, userId } = await register(app, uniq());
    const game = await createGame(app, token, 'public');
    captured.length = 0;

    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 2 },
    });
    expect(res.statusCode).toBeLessThan(300);

    await vi.waitFor(() => expect(eventsNamed(captured, 'achievement_unlocked').length).toBeGreaterThan(0));
    const [trade] = eventsNamed(captured, 'trade_executed');
    expect(trade).toMatchObject({
      distinctId: userId,
      properties: { game_id: game.id, symbol: 'AAPL', direction: 'buy', quantity: 2, origin: 'player' },
    });
    expect(trade?.properties?.['notional']).toBe(2 * Number(trade?.properties?.['price']));
    expect(eventsNamed(captured, 'achievement_unlocked')[0]?.distinctId).toBe(userId);
  });
});

describe('registerAnalytics', () => {
  it('registers nothing without a client', async () => {
    const bus = new EventBus();
    const db = await createTestDb();
    const on = vi.spyOn(bus, 'on');
    registerAnalytics(bus, db as unknown as Db, null);
    expect(on).not.toHaveBeenCalled();
  });

  it("skips admin force-executes, which are not the player's activity", async () => {
    const bus = new EventBus();
    const db = await createTestDb();
    const { client, captured } = fakeClient();
    registerAnalytics(bus, db as unknown as Db, client);

    await bus.emit({
      type: 'trade.executed',
      origin: 'admin',
      gameId: 'g',
      gamePlayerId: 'gp',
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 1,
      tradeId: 't',
      executedAt: new Date().toISOString(),
    });

    expect(captured).toEqual([]);
  });

  it('sends one game_finished per ranked player, each to their own user', async () => {
    const db = await createTestDb();
    const [alice] = await db.insert(schema.users).values({ username: uniq(), passwordHash: 'x' }).returning();
    const [bob] = await db.insert(schema.users).values({ username: uniq(), passwordHash: 'x' }).returning();
    const [game] = await db
      .insert(schema.games)
      .values({
        name: 'g',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2020-02-01T00:00:00.000Z',
        startingBalance: 10000,
        inviteCode: uniq(),
        createdBy: alice!.id,
      })
      .returning();
    const [gpA] = await db.insert(schema.gamePlayers).values({ gameId: game!.id, userId: alice!.id, cashBalance: 1 }).returning();
    const [gpB] = await db.insert(schema.gamePlayers).values({ gameId: game!.id, userId: bob!.id, cashBalance: 1 }).returning();

    const bus = new EventBus();
    const { client, captured } = fakeClient();
    registerAnalytics(bus, db as unknown as Db, client);
    await bus.emit({
      type: 'game.ended',
      gameId: game!.id,
      endedAt: new Date().toISOString(),
      finalRanking: [
        { gamePlayerId: gpA!.id, rank: 1, totalValue: 12000 },
        { gamePlayerId: gpB!.id, rank: 2, totalValue: 9000 },
      ],
    });

    expect(captured.map((c) => [c.distinctId, c.properties?.['final_rank']])).toEqual([
      [alice!.id, 1],
      [bob!.id, 2],
    ]);
    expect(captured[0]?.properties).toMatchObject({ total_players: 2, final_value: 12000 });
  });
});
