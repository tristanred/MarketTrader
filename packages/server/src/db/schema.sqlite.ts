import { sqliteTable, text, real, integer, unique, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/** Registered platform accounts. One user can participate in many games. */
export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** When true, login is rejected with 403. Set by admins via PATCH /admin/users/:id. */
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

/**
 * Authorization groups. Currently a single seeded row: `admin`. Membership is
 * tracked in {@link userGroups}. Users with no group have no special privileges.
 */
export const groups = sqliteTable('groups', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  createdAt: text('created_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

/**
 * Join table assigning users to authorization groups. Both sides cascade so
 * deleting a user or a group automatically tidies up memberships.
 */
export const userGroups = sqliteTable(
  'user_groups',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

/**
 * Append-only audit log for every action performed via the `/admin/*` API.
 * Written inside the same transaction as the action it records — so failed
 * actions leave no log entry, and a logged entry is guaranteed durable.
 *
 * `before`/`after`/`metadata` are JSON-encoded text blobs (parsed at read time
 * by `GET /admin/audit`). `targetId` is nullable for system-level actions.
 */
export const adminAuditLog = sqliteTable('admin_audit_log', {
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
  createdAt: text('created_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

/**
 * Trading tournament instances. `status` is stored here but always recomputed
 * from `startDate`/`endDate` at read time via `recomputeGameStatus`.
 * Dates are stored as ISO 8601 text (SQLite has no native date type).
 */
export const games = sqliteTable('games', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  startingBalance: real('starting_balance').notNull().default(100000),
  allowShortSelling: integer('allow_short_selling', { mode: 'boolean' })
    .notNull()
    .default(false),
  allowLimitOrders: integer('allow_limit_orders', { mode: 'boolean' })
    .notNull()
    .default(false),
  allowStopOrders: integer('allow_stop_orders', { mode: 'boolean' })
    .notNull()
    .default(false),
  allowBracketOrders: integer('allow_bracket_orders', { mode: 'boolean' })
    .notNull()
    .default(false),
  allowGTC: integer('allow_gtc', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** When false, the achievement engine ignores every event for this game. */
  achievementsEnabled: integer('achievements_enabled', { mode: 'boolean' })
    .notNull()
    .default(true),
  status: text('status', { enum: ['pending', 'active', 'ended'] })
    .notNull()
    .default('pending'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
  /**
   * ISO 8601 timestamp set when the portfolio-snapshot worker has compacted
   * this game's `portfolio_snapshots` rows to one-per-player-per-day.
   * Null while the game is active, or for ended games that haven't been
   * processed yet. Compaction is idempotent but skipping already-compacted
   * games keeps the per-tick scan bounded.
   */
  snapshotsCompactedAt: text('snapshots_compacted_at'),
});

/**
 * Join table between users and games. Each row represents one player in one game.
 * `cashBalance` is updated atomically within the trade transaction.
 * The `(gameId, userId)` unique constraint prevents duplicate enrollments.
 */
export const gamePlayers = sqliteTable(
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
    cashBalance: real('cash_balance').notNull(),
    joinedAt: text('joined_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    /**
     * High-water mark of the latest `unlocked_at` timestamp this player has
     * acknowledged seeing as a toast. Used by the WS connect-time replay to
     * avoid re-sending unlocks the player has already toasted. Advanced via
     * `POST /api/games/:gameId/players/:gamePlayerId/achievements/ack`.
     */
    lastSeenUnlockAt: text('last_seen_unlock_at'),
  },
  (t) => [unique().on(t.gameId, t.userId)],
);

/**
 * Current stock holdings per player per game. One row per (gamePlayerId, symbol).
 * `quantity` is always a positive integer; the row is deleted when shares reach 0.
 * `avgCostBasis` is recalculated as a weighted average on each buy.
 */
export const portfolios = sqliteTable(
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
    avgCostBasis: real('avg_cost_basis').notNull(),
    /**
     * ISO 8601 timestamp captured on the buy that transitions quantity from 0 → positive.
     * Unchanged by add-on buys; the row (and column) cease to exist on full close. Used by
     * achievements that measure hold duration of the current position.
     */
    openedAt: text('opened_at'),
  },
  (t) => [unique().on(t.gamePlayerId, t.symbol)],
);

/**
 * Trade lifecycle record. Status semantics:
 * - `executed`: filled immediately at `price` and frozen.
 * - `pending`:  market order queued outside market hours (settled by the
 *   market-hours worker). `reservedPrice`/`reservedCash` lock the estimate.
 * - `working`:  resting limit/stop/stop_limit/bracket order awaiting a price
 *   trigger. `orderType` + `limitPrice`/`stopPrice` describe the trigger.
 * - `cancelled`: user cancel, TIF expiry, OCO-sibling fill, or insufficient
 *   resources at fill. `cancelReason` records why.
 *
 * Brackets are modeled as three rows: a parent (`bracketRole='entry'`) plus
 * two children with `parentTradeId` pointing back. Children stay `working`
 * until the parent fills; the trigger evaluator skips a working child whose
 * parent isn't yet `executed`.
 */
export const trades = sqliteTable('trades', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  gamePlayerId: text('game_player_id')
    .notNull()
    .references(() => gamePlayers.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  direction: text('direction', { enum: ['buy', 'sell'] }).notNull(),
  quantity: integer('quantity').notNull(),
  status: text('status', { enum: ['pending', 'working', 'executed', 'cancelled'] })
    .notNull()
    .default('executed'),
  orderType: text('order_type', {
    enum: ['market', 'limit', 'stop', 'stop_limit', 'bracket'],
  })
    .notNull()
    .default('market'),
  timeInForce: text('time_in_force', { enum: ['day', 'gtc'] }).notNull().default('day'),
  limitPrice: real('limit_price'),
  stopPrice: real('stop_price'),
  /** For stop_limit: set to ISO timestamp once the stop has triggered; null until then. */
  stopTriggeredAt: text('stop_triggered_at'),
  /** Bracket children point at their parent (entry) row. Null on parents. */
  parentTradeId: text('parent_trade_id'),
  bracketRole: text('bracket_role', { enum: ['entry', 'take_profit', 'stop_loss'] }),
  /** Convenience copies on a bracket parent — TP/SL children's prices. Null on non-brackets. */
  takeProfitPrice: real('take_profit_price'),
  stopLossPrice: real('stop_loss_price'),
  /** ISO 8601 expiry for day-TIF orders; null for GTC. */
  expiresAt: text('expires_at'),
  reservedPrice: real('reserved_price'),
  reservedCash: real('reserved_cash'),
  price: real('price'),
  placedAt: text('placed_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
  executedAt: text('executed_at'),
  cancelledAt: text('cancelled_at'),
  cancelReason: text('cancel_reason'),
}, (t) => [
  // The pending/working worker scans by status on every tick.
  index('trades_status_idx').on(t.status),
  // Per-player open-order lists filter by (gamePlayerId, status).
  index('trades_player_status_idx').on(t.gamePlayerId, t.status),
]);

/**
 * Short-lived quote cache (30-second TTL). Keyed by ticker symbol.
 * Used by `CachedProvider` to avoid redundant upstream API calls and by
 * the leaderboard query to value portfolios without hitting the provider.
 */
export const stockPriceCache = sqliteTable('stock_price_cache', {
  symbol: text('symbol').primaryKey(),
  price: real('price').notNull(),
  change: real('change').notNull(),
  changePercent: real('change_percent').notNull(),
  volume: integer('volume'),
  fetchedAt: text('fetched_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

/**
 * User-owned watchlists. Each user can have multiple lists with distinct
 * names. Watchlists are global to a user (not scoped to a single game).
 */
export const watchlists = sqliteTable(
  'watchlists',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => [unique().on(t.userId, t.name)],
);

/**
 * Symbols on a watchlist. Ordered by `addedAt` for stable display.
 * Cascades on watchlist delete. `(watchlistId, symbol)` is unique so adding
 * an already-present symbol is a no-op.
 */
export const watchlistItems = sqliteTable(
  'watchlist_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    watchlistId: text('watchlist_id')
      .notNull()
      .references(() => watchlists.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    addedAt: text('added_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => [unique().on(t.watchlistId, t.symbol)],
);

/**
 * Server-managed runtime configuration. Keys are stable strings; values are
 * JSON-encoded text (the service layer handles encoding/decoding). Phase 2
 * ships exactly one key: `ticker_tape_symbols`. Admin editing arrives in phase 4.
 */
export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
  /** User id of the most recent writer; null when seeded by the server. */
  updatedBy: text('updated_by'),
});

/**
 * Periodic capture of every player's total portfolio value, written by the
 * portfolio-snapshot worker every {@link env.PORTFOLIO_SNAPSHOT_INTERVAL_MS}
 * and on-demand after each trade execution. Powers the leaderboard race chart
 * and per-row sparklines. `rank` is denormalised — recomputing rank from
 * `totalValue` at read time would require every player's value at every
 * timestamp, so we capture it once at write time.
 *
 * Ended games are compacted to one row per player per day (last-of-day);
 * active games keep full 5-minute resolution.
 */
export const portfolioSnapshots = sqliteTable(
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
    capturedAt: text('captured_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    totalValue: real('total_value').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [
    index('portfolio_snapshots_game_time_idx').on(t.gameId, t.capturedAt),
    index('portfolio_snapshots_player_time_idx').on(t.gamePlayerId, t.capturedAt),
  ],
);

/**
 * Per-player per-achievement progress, scoped to a single game. Rows are
 * created lazily on first write by the achievement engine. `target` is
 * snapshotted from the code-defined definition so later changes to a target
 * don't retroactively un-unlock players. `unlockedAt` is set the moment
 * `progress >= target`; once set, the engine treats the row as frozen.
 */
export const achievementProgress = sqliteTable(
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
    unlockedAt: text('unlocked_at'),
    metadata: text('metadata'),
    createdAt: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => [
    unique('uq_achievement_progress_player_key').on(t.gamePlayerId, t.achievementKey),
    index('achievement_progress_game_idx').on(t.gameId),
  ],
);

/**
 * Per-game per-achievement enable/disable override. Absence of a row means
 * use the default (enabled, modulo the global `achievements.disabled`
 * setting and the game-level `achievementsEnabled` flag).
 */
export const gameAchievementOverrides = sqliteTable(
  'game_achievement_overrides',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    achievementKey: text('achievement_key').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    updatedAt: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => [unique('uq_game_achievement_override').on(t.gameId, t.achievementKey)],
);

/**
 * Per-player aggregate stats used by achievements. 1:1 sidecar to {@link gamePlayers}.
 * Updated synchronously inside the trade and snapshot transactions so a handler
 * reading stats never sees a value behind the canonical writes.
 */
export const gamePlayerStats = sqliteTable('game_player_stats', {
  gamePlayerId: text('game_player_id')
    .primaryKey()
    .references(() => gamePlayers.id, { onDelete: 'cascade' }),

  peakPortfolioValue: real('peak_portfolio_value'),
  peakPortfolioAt: text('peak_portfolio_at'),
  troughPortfolioValue: real('trough_portfolio_value'),
  troughPortfolioAt: text('trough_portfolio_at'),

  bestRank: integer('best_rank'),
  worstRank: integer('worst_rank'),
  lastRank: integer('last_rank'),

  daysAtRankOne: integer('days_at_rank_one').notNull().default(0),
  consecutiveDaysAtRankOne: integer('consecutive_days_at_rank_one').notNull().default(0),
  daysInTopThree: integer('days_in_top_three').notNull().default(0),
  consecutiveDaysAtOrAboveMedian: integer('consecutive_days_at_or_above_median').notNull().default(0),
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
  totalVolumeTraded: real('total_volume_traded').notNull().default(0),

  realizedPnl: real('realized_pnl').notNull().default(0),
  winningClosedPositions: integer('winning_closed_positions').notNull().default(0),
  losingClosedPositions: integer('losing_closed_positions').notNull().default(0),
  consecutiveWins: integer('consecutive_wins').notNull().default(0),
  bestSinglePnl: real('best_single_pnl'),
  worstSinglePnl: real('worst_single_pnl'),
  bestSinglePnlPct: real('best_single_pnl_pct'),
  worstSinglePnlPct: real('worst_single_pnl_pct'),

  shortestHoldMs: integer('shortest_hold_ms'),
  longestHoldMs: integer('longest_hold_ms'),

  /** UTC calendar day (`YYYY-MM-DD`) the per-day trade counters apply to. Null until first trade. */
  tradesUtcDate: text('trades_utc_date'),
  /** Number of trades executed on `tradesUtcDate`. Resets at UTC day rollover. */
  tradesToday: integer('trades_today').notNull().default(0),
  /** Number of losing closed positions on `tradesUtcDate`. Resets at UTC day rollover. */
  losingSellsToday: integer('losing_sells_today').notNull().default(0),

  updatedAt: text('updated_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

/**
 * Per-(gamePlayerId, symbol) high-water marks since the most recent
 * 0→positive open. Maintained by the snapshot pipeline with a
 * skip-when-unchanged write. Consumed by behaviour/P&L achievements
 * that need peak/trough observation while a position is open.
 */
export const positionHighWater = sqliteTable(
  'position_high_water',
  {
    gamePlayerId: text('game_player_id')
      .notNull()
      .references(() => gamePlayers.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    openedAt: text('opened_at').notNull(),
    peakValue: real('peak_value').notNull(),
    peakPnlPct: real('peak_pnl_pct').notNull(),
    troughPnlPct: real('trough_pnl_pct').notNull(),
    updatedAt: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.gamePlayerId, t.symbol] })],
);
