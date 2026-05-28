/**
 * Discriminated union of every in-process domain event emitted after a
 * successful DB commit. Consumed by the achievement engine and (potentially)
 * other future subsystems. Events are NOT pushed to clients directly — they
 * are server-internal.
 */
export type DomainEvent =
  | TradeExecutedEvent
  | SnapshotRecordedEvent
  | GameStartedEvent
  | GameEndedEvent
  | PlayerJoinedEvent
  | EngineTickEvent
  | PositionClosedEvent
  | HoldingsChangedEvent
  | AchievementUnlockedEvent;

export type DomainEventType = DomainEvent['type'];

export interface TradeExecutedEvent {
  type: 'trade.executed';
  gameId: string;
  gamePlayerId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  quantity: number;
  price: number;
  tradeId: string;
  executedAt: string;
}

export interface SnapshotRecordedEvent {
  type: 'snapshot.recorded';
  gameId: string;
  gamePlayerId: string;
  totalValue: number;
  /** 1-based rank by descending totalValue at the time of the snapshot. */
  rank: number;
  /** Total players in the game at the time of the snapshot (used for last-place detection). */
  totalPlayers: number;
  capturedAt: string;
}

export interface GameStartedEvent {
  type: 'game.started';
  gameId: string;
  startedAt: string;
}

export interface GameEndedEvent {
  type: 'game.ended';
  gameId: string;
  endedAt: string;
  finalRanking: Array<{ gamePlayerId: string; rank: number; totalValue: number }>;
}

export interface PlayerJoinedEvent {
  type: 'player.joined';
  gameId: string;
  gamePlayerId: string;
  userId: string;
  joinedAt: string;
}

/**
 * Fired at a fixed interval (default 60s) so time-based achievements can
 * advance even without external activity. Handlers should be cheap because
 * this fires for every game in the system.
 */
export interface EngineTickEvent {
  type: 'engine.tick';
  at: string;
}

/** Helper: narrow a DomainEvent by its `type` tag. */
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

/**
 * Fired after a sell trade commits. Carries realized P&L and hold duration so
 * achievement handlers don't need to look up cost basis themselves.
 */
export interface PositionClosedEvent {
  type: 'position.closed';
  gameId: string;
  gamePlayerId: string;
  symbol: string;
  /** Quantity sold in the closing trade. */
  quantity: number;
  /** Realized P&L for this sell slice: (sellPrice − avgCostBasis) × quantity. */
  realizedPnl: number;
  /** Realized P&L as a fraction of cost basis: (sellPrice / avgCostBasis) − 1. */
  realizedPnlPct: number;
  /** Milliseconds between the most recent position open (qty 0 → positive) and this sell. */
  holdDurationMs: number;
  /** True when this sell brought the holding to 0. */
  fullyClosed: boolean;
  closedAt: string;
}

/**
 * Fired after any trade commits. Carries derived holdings metrics so portfolio-
 * shape achievements stay O(1).
 */
export interface HoldingsChangedEvent {
  type: 'holdings.changed';
  gameId: string;
  gamePlayerId: string;
  /** Count of portfolio rows with quantity > 0 after the trade. */
  distinctSymbols: number;
  /** Largest single-symbol value ÷ total portfolio value (0 if no holdings). */
  topConcentrationRatio: number;
  /** Cash ÷ total portfolio value. */
  cashRatio: number;
  changedAt: string;
}

/**
 * Fired after an achievement transitions from locked to unlocked for a
 * player. Emitted from the engine's unlock path (both natural progress
 * completion and explicit `unlock()` calls) so meta-achievements can react
 * to other unlocks. Handlers that respond to this event must guard against
 * self-referential loops (e.g. skip when `achievementKey` is their own key).
 */
export interface AchievementUnlockedEvent {
  type: 'achievement.unlocked';
  gameId: string;
  gamePlayerId: string;
  achievementKey: string;
  unlockedAt: string;
}
