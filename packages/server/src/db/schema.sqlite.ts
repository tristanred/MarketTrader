import { sqliteTable, text, real, integer, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/** Registered platform accounts. One user can participate in many games. */
export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
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
  status: text('status', { enum: ['pending', 'active', 'ended'] })
    .notNull()
    .default('pending'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: text('created_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
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
      .references(() => games.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cashBalance: real('cash_balance').notNull(),
    joinedAt: text('joined_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
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
      .references(() => gamePlayers.id, { onDelete: 'restrict' }),
    symbol: text('symbol').notNull(),
    quantity: integer('quantity').notNull(),
    avgCostBasis: real('avg_cost_basis').notNull(),
  },
  (t) => [unique().on(t.gamePlayerId, t.symbol)],
);

/**
 * Trade lifecycle record. Most rows are `executed` (filled immediately at
 * `price` and frozen). When `MARKET_HOURS_MODE=pending` is active, orders
 * placed outside market hours start as `pending`: `reservedPrice` and
 * `reservedCash` hold the estimate used to lock funds (buys) or shares
 * (sells), and `price`/`executedAt` stay null until the worker settles them.
 * A user-cancelled pending becomes `cancelled` with `cancelledAt` set.
 */
export const trades = sqliteTable('trades', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  gamePlayerId: text('game_player_id')
    .notNull()
    .references(() => gamePlayers.id, { onDelete: 'restrict' }),
  symbol: text('symbol').notNull(),
  direction: text('direction', { enum: ['buy', 'sell'] }).notNull(),
  quantity: integer('quantity').notNull(),
  status: text('status', { enum: ['pending', 'executed', 'cancelled'] })
    .notNull()
    .default('executed'),
  reservedPrice: real('reserved_price'),
  reservedCash: real('reserved_cash'),
  price: real('price'),
  placedAt: text('placed_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
  executedAt: text('executed_at'),
  cancelledAt: text('cancelled_at'),
});

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
