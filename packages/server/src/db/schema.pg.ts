import {
  pgTable,
  text,
  decimal,
  integer,
  timestamp,
  pgEnum,
  boolean,
  unique,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

// PostgreSQL enums for status and direction fields; the SQLite schema uses text enums instead.
export const gameStatusEnum = pgEnum('game_status', ['pending', 'active', 'ended']);
export const tradeDirectionEnum = pgEnum('trade_direction', ['buy', 'sell']);
export const tradeStatusEnum = pgEnum('trade_status', [
  'pending',
  'working',
  'executed',
  'cancelled',
]);
export const orderTypeEnum = pgEnum('order_type', [
  'market',
  'limit',
  'stop',
  'stop_limit',
  'bracket',
]);
export const timeInForceEnum = pgEnum('time_in_force', ['day', 'gtc']);
export const bracketRoleEnum = pgEnum('bracket_role', ['entry', 'take_profit', 'stop_loss']);

/** Registered platform accounts. One user can participate in many games. */
export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** When true, login is rejected with 403. Set by admins via PATCH /admin/users/:id. */
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
});

/**
 * Authorization groups. Currently a single seeded row: `admin`. Membership is
 * tracked in {@link userGroups}. Users with no group have no special privileges.
 */
export const groups = pgTable('groups', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
});

/**
 * Join table assigning users to authorization groups. Both sides cascade so
 * deleting a user or a group automatically tidies up memberships.
 */
export const userGroups = pgTable(
  'user_groups',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

/**
 * Append-only audit log for every action performed via the `/admin/*` API.
 * Written inside the same transaction as the action it records — so failed
 * actions leave no log entry, and a logged entry is guaranteed durable.
 *
 * `before`/`after`/`metadata` are JSONB. `targetId` is nullable for
 * system-level actions.
 */
export const adminAuditLog = pgTable('admin_audit_log', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  adminUserId: text('admin_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  before: text('before'),
  after: text('after'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
});

/**
 * Trading tournament instances. `status` is stored here but always recomputed
 * from `startDate`/`endDate` at read time via `recomputeGameStatus`.
 */
export const games = pgTable('games', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  startDate: timestamp('start_date', { mode: 'string' }).notNull(),
  endDate: timestamp('end_date', { mode: 'string' }).notNull(),
  startingBalance: decimal('starting_balance', { precision: 15, scale: 2 })
    .notNull()
    .default('100000'),
  allowShortSelling: boolean('allow_short_selling').notNull().default(false),
  allowLimitOrders: boolean('allow_limit_orders').notNull().default(false),
  allowStopOrders: boolean('allow_stop_orders').notNull().default(false),
  allowBracketOrders: boolean('allow_bracket_orders').notNull().default(false),
  allowGTC: boolean('allow_gtc').notNull().default(false),
  /** When false, the achievement engine ignores every event for this game. */
  achievementsEnabled: boolean('achievements_enabled').notNull().default(true),
  status: gameStatusEnum('status').notNull().default('pending'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  /**
   * ISO timestamp set when the portfolio-snapshot worker has compacted this
   * game's `portfolio_snapshots` rows to one-per-player-per-day. Null while
   * the game is active.
   */
  snapshotsCompactedAt: timestamp('snapshots_compacted_at', { mode: 'string' }),
});

/**
 * Join table between users and games. Each row represents one player in one game.
 * `cashBalance` is updated atomically within the trade transaction.
 * The `(gameId, userId)` unique constraint prevents duplicate enrollments.
 */
export const gamePlayers = pgTable(
  'game_players',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cashBalance: decimal('cash_balance', { precision: 15, scale: 2 }).notNull(),
    joinedAt: timestamp('joined_at', { mode: 'string' }).defaultNow().notNull(),
    /**
     * High-water mark of the latest `unlocked_at` timestamp this player has
     * acknowledged seeing as a toast. Used by the WS connect-time replay to
     * avoid re-sending unlocks the player has already toasted. Advanced via
     * `POST /api/games/:gameId/players/:gamePlayerId/achievements/ack`.
     */
    lastSeenUnlockAt: timestamp('last_seen_unlock_at', { mode: 'string' }),
  },
  (t) => [unique().on(t.gameId, t.userId)],
);

/**
 * Current stock holdings per player per game. One row per (gamePlayerId, symbol).
 * `quantity` is always a positive integer; the row is deleted when shares reach 0.
 * `avgCostBasis` is recalculated as a weighted average on each buy.
 */
export const portfolios = pgTable(
  'portfolios',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gamePlayerId: text('game_player_id')
      .notNull()
      .references(() => gamePlayers.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    quantity: integer('quantity').notNull(),
    avgCostBasis: decimal('avg_cost_basis', { precision: 15, scale: 2 }).notNull(),
    /**
     * ISO 8601 timestamp captured on the buy that transitions quantity from 0 → positive.
     * Unchanged by add-on buys; the row (and column) cease to exist on full close. Used by
     * achievements that measure hold duration of the current position.
     */
    openedAt: timestamp('opened_at', { mode: 'string' }),
  },
  (t) => [unique().on(t.gamePlayerId, t.symbol)],
);

/**
 * Trade lifecycle record. See the SQLite schema for the full lifecycle
 * description (working/pending → executed | cancelled, with bracket parent/
 * child semantics and TIF-driven expiry).
 */
export const trades = pgTable('trades', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  gamePlayerId: text('game_player_id')
    .notNull()
    .references(() => gamePlayers.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  direction: tradeDirectionEnum('direction').notNull(),
  quantity: integer('quantity').notNull(),
  status: tradeStatusEnum('status').notNull().default('executed'),
  orderType: orderTypeEnum('order_type').notNull().default('market'),
  timeInForce: timeInForceEnum('time_in_force').notNull().default('day'),
  limitPrice: decimal('limit_price', { precision: 15, scale: 4 }),
  stopPrice: decimal('stop_price', { precision: 15, scale: 4 }),
  stopTriggeredAt: timestamp('stop_triggered_at', { mode: 'string' }),
  parentTradeId: text('parent_trade_id'),
  bracketRole: bracketRoleEnum('bracket_role'),
  takeProfitPrice: decimal('take_profit_price', { precision: 15, scale: 4 }),
  stopLossPrice: decimal('stop_loss_price', { precision: 15, scale: 4 }),
  expiresAt: timestamp('expires_at', { mode: 'string' }),
  reservedPrice: decimal('reserved_price', { precision: 15, scale: 4 }),
  reservedCash: decimal('reserved_cash', { precision: 15, scale: 2 }),
  price: decimal('price', { precision: 15, scale: 4 }),
  placedAt: timestamp('placed_at', { mode: 'string' }).defaultNow().notNull(),
  executedAt: timestamp('executed_at', { mode: 'string' }),
  cancelledAt: timestamp('cancelled_at', { mode: 'string' }),
  cancelReason: text('cancel_reason'),
});

/**
 * Short-lived quote cache (30-second TTL). Keyed by ticker symbol.
 * Used by `CachedProvider` to avoid redundant upstream API calls and by
 * the leaderboard query to value portfolios without hitting the provider.
 */
export const stockPriceCache = pgTable('stock_price_cache', {
  symbol: text('symbol').primaryKey(),
  price: decimal('price', { precision: 15, scale: 4 }).notNull(),
  change: decimal('change', { precision: 15, scale: 4 }).notNull(),
  changePercent: decimal('change_percent', { precision: 10, scale: 4 }).notNull(),
  volume: integer('volume'),
  fetchedAt: timestamp('fetched_at', { mode: 'string' }).defaultNow().notNull(),
});

/**
 * User-owned watchlists. Each user can have multiple lists with distinct names.
 * Watchlists are global to a user (not scoped to a single game).
 */
export const watchlists = pgTable(
  'watchlists',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.name)],
);

/**
 * Symbols on a watchlist. Ordered by `addedAt` for stable display.
 * Cascades on watchlist delete. `(watchlistId, symbol)` is unique so adding
 * an already-present symbol is a no-op.
 */
export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    watchlistId: text('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    addedAt: timestamp('added_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.watchlistId, t.symbol)],
);

/**
 * Server-managed runtime configuration. Mirrors the SQLite variant; stores
 * JSON as text in both dialects so the service layer handles encoding.
 * Phase 2 seeds `ticker_tape_symbols`; phase 4 adds admin editing.
 */
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
    .defaultNow()
    .notNull(),
  /** User id of the most recent writer; null when seeded by the server. */
  updatedBy: text('updated_by'),
});

/**
 * Periodic capture of every player's total portfolio value. See the SQLite
 * variant for the full description. Written by the portfolio-snapshot worker
 * at a fixed interval and on each trade execution. Ended games are compacted
 * to one row per player per day.
 */
export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    gamePlayerId: text('game_player_id')
      .notNull()
      .references(() => gamePlayers.id, { onDelete: 'cascade' }),
    capturedAt: timestamp('captured_at', { mode: 'string' }).defaultNow().notNull(),
    totalValue: decimal('total_value', { precision: 15, scale: 2 }).notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [
    index('portfolio_snapshots_game_time_idx').on(t.gameId, t.capturedAt),
    index('portfolio_snapshots_player_time_idx').on(t.gamePlayerId, t.capturedAt),
  ],
);

/**
 * Per-player per-achievement progress, scoped to a single game. Mirrors the
 * SQLite variant. Rows are created lazily by the achievement engine. `target`
 * is snapshotted from the code definition; `unlockedAt` freezes the row once
 * `progress >= target`.
 */
export const achievementProgress = pgTable(
  'achievement_progress',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    gamePlayerId: text('game_player_id')
      .notNull()
      .references(() => gamePlayers.id, { onDelete: 'cascade' }),
    achievementKey: text('achievement_key').notNull(),
    progress: integer('progress').notNull().default(0),
    target: integer('target').notNull(),
    unlockedAt: timestamp('unlocked_at', { mode: 'string' }),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [
    unique('uq_achievement_progress_player_key').on(t.gamePlayerId, t.achievementKey),
    index('achievement_progress_game_idx').on(t.gameId),
  ],
);

/**
 * Per-game per-achievement enable/disable override. Absence = use default.
 */
export const gameAchievementOverrides = pgTable(
  'game_achievement_overrides',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    achievementKey: text('achievement_key').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  },
  (t) => [unique('uq_game_achievement_override').on(t.gameId, t.achievementKey)],
);

/**
 * Per-player aggregate stats used by achievements. 1:1 sidecar to {@link gamePlayers}.
 * Updated synchronously inside the trade and snapshot transactions so a handler
 * reading stats never sees a value behind the canonical writes.
 */
export const gamePlayerStats = pgTable('game_player_stats', {
  gamePlayerId: text('game_player_id')
    .primaryKey()
    .references(() => gamePlayers.id, { onDelete: 'cascade' }),

  peakPortfolioValue: decimal('peak_portfolio_value', { precision: 15, scale: 2 }),
  peakPortfolioAt: timestamp('peak_portfolio_at', { mode: 'string' }),
  troughPortfolioValue: decimal('trough_portfolio_value', { precision: 15, scale: 2 }),
  troughPortfolioAt: timestamp('trough_portfolio_at', { mode: 'string' }),

  bestRank: integer('best_rank'),
  worstRank: integer('worst_rank'),
  lastRank: integer('last_rank'),

  daysAtRankOne: integer('days_at_rank_one').notNull().default(0),
  consecutiveDaysAtRankOne: integer('consecutive_days_at_rank_one').notNull().default(0),
  daysInTopThree: integer('days_in_top_three').notNull().default(0),
  consecutiveDaysAtOrAboveMedian: integer('consecutive_days_at_or_above_median')
    .notNull()
    .default(0),
  consecutiveDaysInLastPlace: integer('consecutive_days_in_last_place').notNull().default(0),
  /** UTC calendar day (`YYYY-MM-DD`) of the most recent snapshot processed by the day-counter rollup. */
  lastDayCounted: text('last_day_counted'),
  /** Rank at the most recent snapshot of `lastDayCounted`; consumed at the next day rollover. */
  lastDayRank: integer('last_day_rank'),
  /**
   * Rank at the final snapshot of the prior UTC day, captured during the
   * rollover branch of `applySnapshotStats`. Lets day-over-day delta
   * achievements (comeback-kid, free-fall) compare today's rank to
   * yesterday's once `lastDayRank` has already been overwritten.
   */
  previousDayRank: integer('previous_day_rank'),

  totalTrades: integer('total_trades').notNull().default(0),
  buyTrades: integer('buy_trades').notNull().default(0),
  sellTrades: integer('sell_trades').notNull().default(0),
  distinctSymbolsTradedEver: integer('distinct_symbols_traded_ever').notNull().default(0),
  totalVolumeTraded: decimal('total_volume_traded', { precision: 18, scale: 2 })
    .notNull()
    .default('0'),

  realizedPnl: decimal('realized_pnl', { precision: 15, scale: 2 }).notNull().default('0'),
  winningClosedPositions: integer('winning_closed_positions').notNull().default(0),
  losingClosedPositions: integer('losing_closed_positions').notNull().default(0),
  consecutiveWins: integer('consecutive_wins').notNull().default(0),
  bestSinglePnl: decimal('best_single_pnl', { precision: 15, scale: 2 }),
  worstSinglePnl: decimal('worst_single_pnl', { precision: 15, scale: 2 }),
  /** Fraction of cost basis, e.g. 0.5 = +50%. */
  bestSinglePnlPct: decimal('best_single_pnl_pct', { precision: 12, scale: 6 }),
  /** Fraction of cost basis, e.g. -0.9 = -90%. */
  worstSinglePnlPct: decimal('worst_single_pnl_pct', { precision: 12, scale: 6 }),

  shortestHoldMs: integer('shortest_hold_ms'),
  longestHoldMs: integer('longest_hold_ms'),

  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
});
