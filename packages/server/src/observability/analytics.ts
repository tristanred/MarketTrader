import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import { env } from '../env.js';
import type { AnalyticsClient } from './posthog.js';

// game_player → user never changes once written, so entries are never stale;
// the cap only bounds memory across a long-lived process.
const USER_ID_CACHE_MAX = 5_000;

/**
 * Forwards business-level {@link DomainEvent}s to PostHog as product events,
 * keyed by `users.id` — the same distinct id the browser `identify`s — so
 * server events and the person's sessions, replays, and errors line up.
 *
 * These are captured here rather than in the browser because the server is the
 * only place that sees all of them: a resting order filled by the settler, or
 * a game that ends on a timer, has no client request behind it.
 *
 * Returns an unsubscribe function. A `null` client registers nothing.
 */
export function registerAnalytics(
  bus: EventBus,
  db: Db,
  client: AnalyticsClient | null,
): () => void {
  if (!client) return () => {};
  const posthog = client;

  const userIds = new Map<string, string>();
  async function userIdOf(gamePlayerId: string): Promise<string | null> {
    const cached = userIds.get(gamePlayerId);
    if (cached) return cached;
    const [row] = await db
      .select({ userId: schema.gamePlayers.userId })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId))
      .limit(1);
    if (!row) return null;
    if (userIds.size >= USER_ID_CACHE_MAX) {
      const oldest = userIds.keys().next().value;
      if (oldest !== undefined) userIds.delete(oldest);
    }
    userIds.set(gamePlayerId, row.userId);
    return row.userId;
  }

  function send(distinctId: string, event: string, properties: Record<string, unknown>): void {
    // Dev and production share one PostHog project; this is what separates them.
    posthog.capture({ distinctId, event, properties: { environment: env.NODE_ENV, ...properties } });
  }

  const unsubscribers = [
    bus.on('game.created', (e) => {
      send(e.createdByUserId, 'game_created', {
        game_id: e.gameId,
        visibility: e.visibility,
        allow_short_selling: e.allowShortSelling,
        allow_gtc: e.allowGTC,
      });
    }),
    bus.on('player.joined', (e) => {
      send(e.userId, 'game_joined', { game_id: e.gameId, join_source: e.joinSource });
    }),
    bus.on('trade.executed', async (e) => {
      // An admin force-execute is the admin's action, not the player's activity.
      if (e.origin === 'admin') return;
      const userId = await userIdOf(e.gamePlayerId);
      if (!userId) return;
      send(userId, 'trade_executed', {
        game_id: e.gameId,
        symbol: e.symbol,
        direction: e.direction,
        quantity: e.quantity,
        price: e.price,
        notional: e.quantity * e.price,
        origin: e.origin,
      });
    }),
    bus.on('achievement.unlocked', async (e) => {
      const userId = await userIdOf(e.gamePlayerId);
      if (!userId) return;
      send(userId, 'achievement_unlocked', {
        game_id: e.gameId,
        achievement_key: e.achievementKey,
      });
    }),
    bus.on('game.ended', async (e) => {
      for (const entry of e.finalRanking) {
        const userId = await userIdOf(entry.gamePlayerId);
        if (!userId) continue;
        send(userId, 'game_finished', {
          game_id: e.gameId,
          final_rank: entry.rank,
          total_players: e.finalRanking.length,
          final_value: entry.totalValue,
        });
      }
    }),
  ];

  return () => {
    for (const off of unsubscribers) off();
  };
}
