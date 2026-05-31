import type { DomainEventOf, DomainEventType } from '../events/types.js';
import type { Db } from '../db/index.js';
import type { AchievementRarity } from '@markettrader/shared';

export type { AchievementRarity };

/**
 * Helper context passed to every achievement handler. Hides all DB and
 * broadcast plumbing so individual achievements only express their logic.
 *
 * All helpers operate on a single (gamePlayerId, achievementKey) row. They
 * upsert the row on first call, are idempotent once the row is unlocked,
 * and trigger the `achievement_unlocked` WS broadcast automatically when
 * progress reaches the target.
 */
export interface AchievementContext {
  /** Game the current event belongs to. */
  readonly gameId: string;
  /** Direct DB handle for unusual achievements that need extra queries. */
  readonly db: Db;
  /** Sets progress = target and marks unlocked. No-op if already unlocked. */
  unlock(gamePlayerId: string): Promise<void>;
  /**
   * Atomically adds `delta` to progress. Auto-unlocks once progress ≥ target.
   * No-op when the row is already unlocked.
   */
  increment(gamePlayerId: string, delta: number): Promise<void>;
  /**
   * Sets progress to an absolute value. Auto-unlocks when value ≥ target.
   * No-op when the row is already unlocked.
   */
  setProgress(gamePlayerId: string, value: number): Promise<void>;
  /** Reads the current row, creating a zeroed row if none exists yet. */
  getProgress(gamePlayerId: string): Promise<{ progress: number; target: number; unlockedAt: string | null }>;
  /** All achievement keys registered in the engine. Order is registration order. */
  allAchievementKeys(): readonly string[];
  /** Effective per-game enable check for a single achievement key. */
  isAchievementEnabled(gameId: string, key: string): Promise<boolean>;
}

/**
 * Definition of a single achievement, the surface that authors edit.
 * Add a new file under `definitions/` exporting one of these objects and
 * re-export it from `definitions/index.ts`.
 */
export interface AchievementDefinition<TEvents extends DomainEventType = DomainEventType> {
  /** Stable identifier; persisted in `achievement_progress.achievement_key`. */
  key: string;
  name: string;
  description: string;
  /** Optional grouping label exposed via the API for UI presentation. */
  category?: string;
  /** Visual tier — drives rarity color in the UI. Required. */
  rarity: AchievementRarity;
  /** Lucide icon name (kebab-case, e.g. 'flame', 'trending-up'). Required. */
  icon: string;
  /** Numeric target. Boolean achievements use `1`. */
  target: number;
  /** Optional. When true, hidden from the catalog until the player unlocks it. Defaults to false. */
  secret?: boolean;
  /** Which event types the handler subscribes to. */
  events: readonly TEvents[];
  /** Handler invoked once per subscribed event after a successful DB commit. */
  onEvent(event: DomainEventOf<TEvents>, ctx: AchievementContext): void | Promise<void>;
}

/**
 * Type-erased achievement definition, used by the engine's registry where a
 * heterogeneous array of definitions is stored. Equivalent to
 * `AchievementDefinition<DomainEventType>` but expressed as a thin interface
 * so it's variance-compatible with any specific `TEvents` instantiation.
 */
export type AnyAchievementDefinition = Omit<AchievementDefinition, 'events' | 'onEvent'> & {
  events: readonly DomainEventType[];
  onEvent(event: DomainEventOf<DomainEventType>, ctx: AchievementContext): void | Promise<void>;
};

/**
 * Identity helper that narrows the handler's event type based on the
 * `events` literal array. Authors get autocomplete on event fields.
 */
export function defineAchievement<const TEvents extends DomainEventType>(
  spec: AchievementDefinition<TEvents>,
): AnyAchievementDefinition {
  return spec as unknown as AnyAchievementDefinition;
}
