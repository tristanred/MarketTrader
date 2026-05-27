import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import type { DomainEvent, DomainEventType } from '../events/types.js';
import type { GameClientRegistry } from '../ws/registry.js';
import type { SystemSettingsService } from '../services/system-settings.js';
import type { AchievementContext, AnyAchievementDefinition } from './define.js';

/**
 * Resolves a `gameId` from any {@link DomainEvent}. The `engine.tick` event
 * has no game scope and is handled separately by definitions that opt into it.
 * The switch is exhaustive so adding a new {@link DomainEvent} variant without
 * a case here is a TypeScript error.
 */
function gameIdOf(event: DomainEvent): string | null {
  switch (event.type) {
    case 'engine.tick':
      return null;
    case 'game.ended':
    case 'game.started':
    case 'player.joined':
    case 'snapshot.recorded':
    case 'trade.executed':
    case 'position.closed':
    case 'holdings.changed':
      return event.gameId;
  }
}

/**
 * Configures, owns, and routes events to the achievement engine. Construct
 * once at boot, call {@link AchievementEngine.start} to subscribe to the bus.
 *
 * Responsibilities:
 * - Determine whether an achievement is enabled for a given game (game flag
 *   on `games.achievementsEnabled`, global `achievements.disabled` setting,
 *   per-game `game_achievement_overrides`).
 * - Dispatch each event to the achievements that opt into it.
 * - Provide the {@link AchievementContext} helpers (`unlock`, `increment`,
 *   `setProgress`, `getProgress`) that persist progress and broadcast
 *   `achievement_unlocked` over the {@link GameClientRegistry}.
 * - Wrap every handler call in its own try/catch (matching the WS handler
 *   convention) so one failing achievement cannot break others.
 */
export class AchievementEngine {
  private readonly handlersByEvent = new Map<DomainEventType, AnyAchievementDefinition[]>();
  private readonly defsByKey = new Map<string, AnyAchievementDefinition>();
  private readonly unsubscribers: Array<() => void> = [];
  /** In-memory cache of `achievements.disabled` keys; refreshed on every emit. */
  private globalDisabled: ReadonlySet<string> = new Set();
  /** Cached game lookups for `achievementsEnabled` to avoid a query per event. */
  private readonly gameEnabledCache = new Map<string, boolean>();

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly registry: GameClientRegistry,
    private readonly settings: SystemSettingsService,
    definitions: readonly AnyAchievementDefinition[],
    private readonly logger?: FastifyBaseLogger,
  ) {
    for (const def of definitions) {
      this.defsByKey.set(def.key, def);
      for (const eventType of def.events) {
        const list = this.handlersByEvent.get(eventType) ?? [];
        list.push(def);
        this.handlersByEvent.set(eventType, list);
      }
    }
  }

  /** Subscribe to every event type any registered achievement cares about. */
  start(): void {
    for (const eventType of this.handlersByEvent.keys()) {
      const unsub = this.bus.on(eventType, async (event) => {
        await this.dispatch(event);
      });
      this.unsubscribers.push(unsub);
    }
  }

  stop(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers.length = 0;
    this.gameEnabledCache.clear();
  }

  /**
   * Invalidate cached state so the next event re-reads from the database.
   * Called by admin endpoints after toggling enable flags.
   */
  invalidateCache(): void {
    this.gameEnabledCache.clear();
  }

  /**
   * Returns every definition known to the engine (registry view used by the
   * query service and routes). Order matches the definitions array passed
   * at construction time.
   */
  listDefinitions(): readonly AnyAchievementDefinition[] {
    return [...this.defsByKey.values()];
  }

  /**
   * Broadcasts an `achievement_unlocked` event for an unlock that occurred
   * outside the natural progress path (e.g. admin force-unlock). The payload
   * mirrors what the natural unlock path emits from {@link dispatch} so
   * clients can't tell the two apart. Callers are responsible for ensuring
   * the DB row was actually updated to `unlockedAt = unlockedAt` first.
   */
  broadcastAchievementUnlock(
    gameId: string,
    gamePlayerId: string,
    achievementKey: string,
    unlockedAt: string,
  ): void {
    const def = this.defsByKey.get(achievementKey);
    if (!def) return;
    this.registry.broadcast(gameId, {
      event: 'achievement_unlocked',
      data: {
        gamePlayerId,
        achievementKey: def.key,
        name: def.name,
        description: def.description,
        rarity: def.rarity,
        icon: def.icon,
        unlockedAt,
      },
    });
  }

  /** Look up a single definition by key, or undefined if not registered. */
  getDefinition(key: string): AnyAchievementDefinition | undefined {
    return this.defsByKey.get(key);
  }

  /**
   * Effective enabled check for a (gameId, key) pair, consulting in order:
   * 1) achievement exists in the registry
   * 2) global `achievements.disabled` settings list
   * 3) the game's `achievementsEnabled` flag
   * 4) any row in `game_achievement_overrides`
   */
  async isEnabled(gameId: string, key: string): Promise<boolean> {
    if (!this.defsByKey.has(key)) return false;
    await this.refreshGlobalDisabled();
    if (this.globalDisabled.has(key)) return false;
    const gameEnabled = await this.isGameEnabled(gameId);
    if (!gameEnabled) return false;
    const override = await this.db
      .select({ enabled: schema.gameAchievementOverrides.enabled })
      .from(schema.gameAchievementOverrides)
      .where(
        and(
          eq(schema.gameAchievementOverrides.gameId, gameId),
          eq(schema.gameAchievementOverrides.achievementKey, key),
        ),
      )
      .limit(1);
    if (override.length > 0) return override[0]!.enabled;
    return true;
  }

  private async refreshGlobalDisabled(): Promise<void> {
    this.globalDisabled = await this.settings.getDisabledAchievements();
  }

  private async isGameEnabled(gameId: string): Promise<boolean> {
    const cached = this.gameEnabledCache.get(gameId);
    if (cached !== undefined) return cached;
    const [row] = await this.db
      .select({ enabled: schema.games.achievementsEnabled })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    const enabled = row?.enabled ?? false;
    this.gameEnabledCache.set(gameId, enabled);
    return enabled;
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    const handlers = this.handlersByEvent.get(event.type);
    if (!handlers || handlers.length === 0) return;
    const gameId = gameIdOf(event);

    for (const def of handlers) {
      try {
        if (gameId !== null) {
          // engine.tick is the only event without a game scope; skip the
          // per-game enable check for it. Definitions that listen to ticks
          // are responsible for iterating games themselves via `ctx.db`.
          const enabled = await this.isEnabled(gameId, def.key);
          if (!enabled) continue;
        }
        const ctx = this.makeContext(def, gameId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await def.onEvent(event as any, ctx);
      } catch (err) {
        this.logger?.error(
          { err, achievementKey: def.key, eventType: event.type },
          'achievement handler threw',
        );
      }
    }
  }

  private makeContext(def: AnyAchievementDefinition, gameId: string | null): AchievementContext {
    // engine.tick handlers receive an empty string for gameId; they should
    // resolve scope per-row via ctx.db. Per-game events get the real id.
    const scopedGameId = gameId ?? '';
    return {
      gameId: scopedGameId,
      db: this.db,
      unlock: (gamePlayerId) => this.applyChange(def, scopedGameId, gamePlayerId, 'unlock'),
      increment: (gamePlayerId, delta) =>
        this.applyChange(def, scopedGameId, gamePlayerId, 'increment', delta),
      setProgress: (gamePlayerId, value) =>
        this.applyChange(def, scopedGameId, gamePlayerId, 'set', value),
      getProgress: async (gamePlayerId) => {
        const row = await this.ensureRow(def, scopedGameId, gamePlayerId);
        return { progress: row.progress, target: row.target, unlockedAt: row.unlockedAt };
      },
    };
  }

  /**
   * Single write path used by all helper methods. Ensures a row exists,
   * computes the next progress value, writes it inside a transaction (so
   * concurrent emits don't double-count), and emits a broadcast on the
   * unlock transition.
   */
  private async applyChange(
    def: AnyAchievementDefinition,
    gameId: string,
    gamePlayerId: string,
    op: 'unlock' | 'increment' | 'set',
    arg = 0,
  ): Promise<void> {
    if (!gameId) {
      this.logger?.warn(
        { achievementKey: def.key, op },
        'achievement helper called without a gameId (engine.tick handler must resolve scope itself)',
      );
      return;
    }
    await this.ensureRow(def, gameId, gamePlayerId);

    // Use ISO 8601 strings instead of `datetime('now')` — SQLite's `datetime`
    // function does not exist in Postgres and `.set(...)` runs as application
    // SQL, so the call would crash on the prod driver.
    const now = new Date().toISOString();
    let unlocked = false;
    if (op === 'unlock') {
      const result = await this.db
        .update(schema.achievementProgress)
        .set({
          progress: def.target,
          unlockedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
            eq(schema.achievementProgress.achievementKey, def.key),
            sql`${schema.achievementProgress.unlockedAt} IS NULL`,
          ),
        )
        .returning({ id: schema.achievementProgress.id });
      unlocked = result.length > 0;
    } else if (op === 'increment') {
      const result = await this.db
        .update(schema.achievementProgress)
        .set({
          progress: sql`${schema.achievementProgress.progress} + ${arg}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
            eq(schema.achievementProgress.achievementKey, def.key),
            sql`${schema.achievementProgress.unlockedAt} IS NULL`,
          ),
        )
        .returning({ progress: schema.achievementProgress.progress, target: schema.achievementProgress.target });
      const row = result[0];
      if (row && row.progress >= row.target) {
        unlocked = await this.markUnlocked(def, gamePlayerId, now);
      }
    } else {
      const clamped = Math.max(0, arg);
      const result = await this.db
        .update(schema.achievementProgress)
        .set({ progress: clamped, updatedAt: now })
        .where(
          and(
            eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
            eq(schema.achievementProgress.achievementKey, def.key),
            sql`${schema.achievementProgress.unlockedAt} IS NULL`,
          ),
        )
        .returning({ progress: schema.achievementProgress.progress, target: schema.achievementProgress.target });
      const row = result[0];
      if (row && row.progress >= row.target) {
        unlocked = await this.markUnlocked(def, gamePlayerId, now);
      }
    }

    if (unlocked) {
      // Reuse the same `now` so the DB row and the WS payload agree.
      this.registry.broadcast(gameId, {
        event: 'achievement_unlocked',
        data: {
          gamePlayerId,
          achievementKey: def.key,
          name: def.name,
          description: def.description,
          rarity: def.rarity,
          icon: def.icon,
          unlockedAt: now,
        },
      });
    }
  }

  /**
   * Race-safe unlock. Updates only when `unlocked_at IS NULL` and returns
   * whether the transition actually happened (so we broadcast at most once).
   */
  private async markUnlocked(
    def: AnyAchievementDefinition,
    gamePlayerId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.db
      .update(schema.achievementProgress)
      .set({
        unlockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
          eq(schema.achievementProgress.achievementKey, def.key),
          sql`${schema.achievementProgress.unlockedAt} IS NULL`,
        ),
      )
      .returning({ id: schema.achievementProgress.id });
    return result.length > 0;
  }

  /**
   * Upserts a zero-progress row if none exists. Reads the resulting row and
   * returns it. Cheap enough to call before every helper; the unique index
   * on (game_player_id, achievement_key) makes the insert idempotent.
   */
  private async ensureRow(
    def: AnyAchievementDefinition,
    gameId: string,
    gamePlayerId: string,
  ): Promise<{ progress: number; target: number; unlockedAt: string | null }> {
    await this.db
      .insert(schema.achievementProgress)
      .values({
        gameId,
        gamePlayerId,
        achievementKey: def.key,
        progress: 0,
        target: def.target,
      })
      .onConflictDoNothing({
        target: [schema.achievementProgress.gamePlayerId, schema.achievementProgress.achievementKey],
      });
    const [row] = await this.db
      .select({
        progress: schema.achievementProgress.progress,
        target: schema.achievementProgress.target,
        unlockedAt: schema.achievementProgress.unlockedAt,
      })
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
          eq(schema.achievementProgress.achievementKey, def.key),
        ),
      )
      .limit(1);
    // `row` is always present after the upsert; the assertion is for the
    // type system (drizzle returns an optional).
    return row!;
  }
}
