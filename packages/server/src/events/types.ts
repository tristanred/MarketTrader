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
  | EngineTickEvent;

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
