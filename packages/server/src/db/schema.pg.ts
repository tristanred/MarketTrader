import {
  pgTable,
  text,
  decimal,
  integer,
  timestamp,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core';

export const gameStatusEnum = pgEnum('game_status', ['pending', 'active', 'ended']);
export const tradeDirectionEnum = pgEnum('trade_direction', ['buy', 'sell']);

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const games = pgTable('games', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  startingBalance: decimal('starting_balance', { precision: 15, scale: 2 })
    .notNull()
    .default('100000'),
  status: gameStatusEnum('status').notNull().default('pending'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.gameId, t.userId)],
);

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
  price: decimal('price', { precision: 15, scale: 4 }).notNull(),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
});

export const stockPriceCache = pgTable('stock_price_cache', {
  symbol: text('symbol').primaryKey(),
  price: decimal('price', { precision: 15, scale: 4 }).notNull(),
  change: decimal('change', { precision: 15, scale: 4 }).notNull(),
  changePercent: decimal('change_percent', { precision: 10, scale: 4 }).notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
});
