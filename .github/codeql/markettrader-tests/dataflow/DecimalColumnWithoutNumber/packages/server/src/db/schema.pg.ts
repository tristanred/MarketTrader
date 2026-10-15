import { pgTable, text, integer, decimal, timestamp } from 'drizzle-orm/pg-core';

export const games = pgTable('games', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startingBalance: decimal('starting_balance', { precision: 15, scale: 2 }).notNull().default('10000'),
});

export const gamePlayers = pgTable('game_players', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  userId: text('user_id').notNull(),
  cashBalance: decimal('cash_balance', { precision: 15, scale: 2 }).notNull(),
});

export const trades = pgTable('trades', {
  id: text('id').primaryKey(),
  gamePlayerId: text('game_player_id').notNull(),
  quantity: integer('quantity').notNull(),
  price: decimal('price', { precision: 15, scale: 4 }),
  executedAt: timestamp('executed_at', { mode: 'string' }),
});
