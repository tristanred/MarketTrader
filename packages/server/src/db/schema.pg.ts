import {
  pgTable,
  text,
  decimal,
  integer,
  timestamp,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core';

// PostgreSQL enums for status and direction fields; the SQLite schema uses text enums instead.
export const gameStatusEnum = pgEnum('game_status', ['pending', 'active', 'ended']);
export const tradeDirectionEnum = pgEnum('trade_direction', ['buy', 'sell']);
export const tradeStatusEnum = pgEnum('trade_status', ['pending', 'executed', 'cancelled']);

/** Registered platform accounts. One user can participate in many games. */
export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
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
  status: gameStatusEnum('status').notNull().default('pending'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
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
      .references(() => games.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cashBalance: decimal('cash_balance', { precision: 15, scale: 2 }).notNull(),
    joinedAt: timestamp('joined_at', { mode: 'string' }).defaultNow().notNull(),
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
      .references(() => gamePlayers.id, { onDelete: 'restrict' }),
    symbol: text('symbol').notNull(),
    quantity: integer('quantity').notNull(),
    avgCostBasis: decimal('avg_cost_basis', { precision: 15, scale: 2 }).notNull(),
  },
  (t) => [unique().on(t.gamePlayerId, t.symbol)],
);

/**
 * Trade lifecycle record. See the SQLite schema for the full lifecycle
 * description (pending → executed | cancelled).
 */
export const trades = pgTable('trades', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  gamePlayerId: text('game_player_id')
    .notNull()
    .references(() => gamePlayers.id, { onDelete: 'restrict' }),
  symbol: text('symbol').notNull(),
  direction: tradeDirectionEnum('direction').notNull(),
  quantity: integer('quantity').notNull(),
  status: tradeStatusEnum('status').notNull().default('executed'),
  reservedPrice: decimal('reserved_price', { precision: 15, scale: 4 }),
  reservedCash: decimal('reserved_cash', { precision: 15, scale: 2 }),
  price: decimal('price', { precision: 15, scale: 4 }),
  placedAt: timestamp('placed_at', { mode: 'string' }).defaultNow().notNull(),
  executedAt: timestamp('executed_at', { mode: 'string' }),
  cancelledAt: timestamp('cancelled_at', { mode: 'string' }),
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
  fetchedAt: timestamp('fetched_at', { mode: 'string' }).defaultNow().notNull(),
});
