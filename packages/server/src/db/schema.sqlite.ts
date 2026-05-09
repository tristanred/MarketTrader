import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

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
    .references(() => users.id),
  createdAt: text('created_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const gamePlayers = sqliteTable('game_players', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  cashBalance: real('cash_balance').notNull(),
  joinedAt: text('joined_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const portfolios = sqliteTable('portfolios', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  gamePlayerId: text('game_player_id')
    .notNull()
    .references(() => gamePlayers.id),
  symbol: text('symbol').notNull(),
  quantity: integer('quantity').notNull(),
  avgCostBasis: real('avg_cost_basis').notNull(),
});

export const trades = sqliteTable('trades', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  gamePlayerId: text('game_player_id')
    .notNull()
    .references(() => gamePlayers.id),
  symbol: text('symbol').notNull(),
  direction: text('direction', { enum: ['buy', 'sell'] }).notNull(),
  quantity: integer('quantity').notNull(),
  price: real('price').notNull(),
  executedAt: text('executed_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const stockPriceCache = sqliteTable('stock_price_cache', {
  symbol: text('symbol').primaryKey(),
  price: real('price').notNull(),
  change: real('change').notNull(),
  changePercent: real('change_percent').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});
