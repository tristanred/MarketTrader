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
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
      .references(() => gamePlayers.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    quantity: integer('quantity').notNull(),
    avgCostBasis: decimal('avg_cost_basis', { precision: 15, scale: 2 }).notNull(),
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
