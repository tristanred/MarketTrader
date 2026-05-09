# MarketTrader Project Scaffolding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the complete MarketTrader pnpm monorepo — all three packages wired together, TypeScript compiling cleanly, server responding to a health check, frontend showing a placeholder page, Docker Compose working, and CI green.

**Architecture:** pnpm workspace monorepo with three packages (`shared`, `server`, `frontend`). Shared types are imported by both server and frontend to enforce API contracts at compile time. `tsx` is used for server development; `tsc`+`tsup` for production build. Vite handles the frontend in both dev and production modes.

**Tech Stack:** pnpm 9, TypeScript 5.7, Fastify 5, Drizzle ORM 0.38, tsx, tsup, React 19, Vite 6, Vitest 2, Tailwind CSS 3, ShadCN/UI, Docker Compose, GitHub Actions.

---

## Scope — This Plan Only

This plan produces a **working skeleton** with no business logic. Subsequent plans:
- **Plan 2:** Auth endpoints (`POST /auth/register`, `POST /auth/login`, JWT middleware)
- **Plan 3:** Game & trading API (games CRUD, join, portfolio, trade execution, stock price provider)
- **Plan 4:** WebSocket server (per-game channels, price broadcasting, leaderboard push)
- **Plan 5:** Frontend features (auth pages, game pages, trading UI, TradingView charts)

---

## File Map

All files created in this plan:

```
MarketTrader/
├── package.json                               # workspace root scripts + devDeps
├── pnpm-workspace.yaml                        # packages/* workspace definition
├── tsconfig.base.json                         # shared TypeScript base config
├── .gitignore
├── .prettierrc
├── eslint.config.mjs                          # flat ESLint config (ESLint 9)
├── docker-compose.yml                         # PostgreSQL for local dev + server service
├── Dockerfile.server                          # multi-stage production build
├── .env.example
│
├── .github/
│   └── workflows/
│       └── ci.yml                             # typecheck + lint + test
│
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types/
│   │       │   ├── auth.ts                    # RegisterRequest, LoginRequest, AuthResponse
│   │       │   ├── game.ts                    # Game, CreateGameRequest, GameStatus, LeaderboardEntry
│   │       │   ├── player.ts                  # GamePlayer, Portfolio, Trade, PlaceTradeRequest
│   │       │   ├── stock.ts                   # StockQuote, StockSearchResult
│   │       │   └── websocket.ts               # WsServerEvent, WsClientEvent discriminated unions
│   │       └── index.ts
│   │
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json                # extends tsconfig.json, used by tsup
│   │   ├── tsup.config.ts
│   │   ├── vitest.config.ts
│   │   ├── drizzle.config.ts
│   │   ├── src/
│   │   │   ├── env.ts                         # typed env parsing, throws on missing required vars
│   │   │   ├── app.ts                         # buildApp(): Fastify instance + plugins + routes
│   │   │   ├── index.ts                       # entry point: reads env, starts server
│   │   │   ├── plugins/
│   │   │   │   ├── cors.ts                    # @fastify/cors registration
│   │   │   │   └── sensible.ts                # @fastify/sensible (HTTP helpers)
│   │   │   ├── routes/
│   │   │   │   └── health.ts                  # GET /health → { status, timestamp }
│   │   │   └── db/
│   │   │       ├── schema.pg.ts               # Drizzle schema using pg-core
│   │   │       ├── schema.sqlite.ts           # Drizzle schema using sqlite-core
│   │   │       └── index.ts                   # driver + schema selection by DATABASE_URL
│   │   └── tests/
│   │       └── health.test.ts                 # Vitest: GET /health returns 200 { status: 'ok' }
│   │
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts                     # also contains vitest config block
│       ├── tailwind.config.ts
│       ├── postcss.config.ts
│       ├── components.json                    # ShadCN config
│       ├── index.html
│       └── src/
│           ├── vite-env.d.ts
│           ├── index.css                      # Tailwind directives + ShadCN CSS variables
│           ├── main.tsx                       # ReactDOM.createRoot entry
│           └── App.tsx                        # placeholder: "MarketTrader" heading
│       └── tests/
│           ├── setup.ts                       # @testing-library/jest-dom import
│           └── App.test.tsx                   # renders App, finds heading
```

---

## Task 1: Root Workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.prettierrc`
- Create: `eslint.config.mjs`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "markettrader",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel --filter './packages/*' dev",
    "build": "pnpm --filter shared build && pnpm --parallel --filter 'server frontend' build",
    "test": "pnpm --filter './packages/*' test",
    "typecheck": "pnpm --filter './packages/*' typecheck",
    "lint": "pnpm --filter './packages/*' lint"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
*.db
*.db-journal
coverage/
.turbo/
```

- [ ] **Step 5: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 6: Create `eslint.config.mjs`**

```javascript
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'],
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx', 'packages/*/tests/**/*.ts', 'packages/*/tests/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs['recommended'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
```

- [ ] **Step 7: Install root devDependencies**

Run: `pnpm install`

Expected: `node_modules/` created at root, lock file updated, no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .prettierrc eslint.config.mjs
git commit -m "chore: initialize pnpm monorepo workspace"
```

---

## Task 2: Shared Types Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types/auth.ts`
- Create: `packages/shared/src/types/game.ts`
- Create: `packages/shared/src/types/player.ts`
- Create: `packages/shared/src/types/stock.ts`
- Create: `packages/shared/src/types/websocket.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@markettrader/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "dev": "tsc --watch",
    "lint": "echo 'no lint for shared'"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/src/types/auth.ts`**

```typescript
export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
```

- [ ] **Step 4: Create `packages/shared/src/types/game.ts`**

```typescript
export type GameStatus = 'pending' | 'active' | 'ended';

export interface Game {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  status: GameStatus;
  createdBy: string;
  createdAt: string;
}

export interface CreateGameRequest {
  name: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
}

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  totalValue: number;
  rank: number;
}

export interface GameWithLeaderboard extends Game {
  leaderboard: LeaderboardEntry[];
}
```

- [ ] **Step 5: Create `packages/shared/src/types/player.ts`**

```typescript
export interface GamePlayer {
  id: string;
  gameId: string;
  userId: string;
  cashBalance: number;
  joinedAt: string;
}

export interface Portfolio {
  id: string;
  gamePlayerId: string;
  symbol: string;
  quantity: number;
  avgCostBasis: number;
}

export type TradeDirection = 'buy' | 'sell';

export interface Trade {
  id: string;
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  price: number;
  executedAt: string;
}

export interface PlaceTradeRequest {
  symbol: string;
  direction: TradeDirection;
  quantity: number;
}
```

- [ ] **Step 6: Create `packages/shared/src/types/stock.ts`**

```typescript
export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  fetchedAt: string;
}

export interface StockSearchResult {
  symbol: string;
  name: string;
}
```

- [ ] **Step 7: Create `packages/shared/src/types/websocket.ts`**

```typescript
import type { StockQuote } from './stock.js';
import type { LeaderboardEntry } from './game.js';
import type { TradeDirection } from './player.js';

export interface WsPriceUpdateEvent {
  event: 'price_update';
  data: StockQuote[];
}

export interface WsTradeExecutedEvent {
  event: 'trade_executed';
  data: {
    playerId: string;
    symbol: string;
    direction: TradeDirection;
    quantity: number;
    price: number;
  };
}

export interface WsLeaderboardUpdateEvent {
  event: 'leaderboard_update';
  data: LeaderboardEntry[];
}

export interface WsSubscribeEvent {
  event: 'subscribe';
  data: { symbols: string[] };
}

export type WsServerEvent =
  | WsPriceUpdateEvent
  | WsTradeExecutedEvent
  | WsLeaderboardUpdateEvent;

export type WsClientEvent = WsSubscribeEvent;
```

- [ ] **Step 8: Create `packages/shared/src/index.ts`**

```typescript
export * from './types/auth.js';
export * from './types/game.js';
export * from './types/player.js';
export * from './types/stock.js';
export * from './types/websocket.js';
```

- [ ] **Step 9: Build and verify**

Run: `pnpm --filter shared build`

Expected: `packages/shared/dist/` created with `.js`, `.d.ts`, `.d.ts.map` files. No TypeScript errors.

Run: `pnpm --filter shared typecheck`

Expected: exits 0 with no output (means 0 errors).

- [ ] **Step 10: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add TypeScript API contract types"
```

---

## Task 3: Server — Fastify Skeleton + Health Endpoint

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/tsup.config.ts`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/env.ts`
- Create: `packages/server/src/plugins/cors.ts`
- Create: `packages/server/src/plugins/sensible.ts`
- Create: `packages/server/src/routes/health.ts`
- Create: `packages/server/tests/health.test.ts`  ← write BEFORE app.ts
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Create `packages/server/package.json`**

```json
{
  "name": "@markettrader/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@fastify/jwt": "^9.0.0",
    "@fastify/sensible": "^6.0.0",
    "@fastify/websocket": "^8.0.0",
    "@markettrader/shared": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.38.0",
    "fastify": "^5.0.0",
    "postgres": "^3.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "drizzle-kit": "^0.29.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `packages/server/tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
});
```

- [ ] **Step 4: Create `packages/server/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `packages/server/src/env.ts`**

```typescript
function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  DATABASE_URL: optional('DATABASE_URL', './dev.db'),
  JWT_SECRET: optional('JWT_SECRET', 'dev-secret-change-in-production'),
  PORT: parseInt(optional('PORT', '3000'), 10),
  CORS_ORIGIN: optional('CORS_ORIGIN', 'http://localhost:5173'),
  STOCK_PROVIDER: optional('STOCK_PROVIDER', 'yahoo') as 'yahoo' | 'alpaca' | 'polygon',
  NODE_ENV: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
} as const;
```

- [ ] **Step 6: Create `packages/server/src/plugins/cors.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../env.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
}
```

- [ ] **Step 7: Create `packages/server/src/plugins/sensible.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

export async function registerSensible(app: FastifyInstance): Promise<void> {
  await app.register(sensible);
}
```

- [ ] **Step 8: Create `packages/server/src/routes/health.ts`**

```typescript
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
}
```

- [ ] **Step 9: Write the failing test FIRST**

Create `packages/server/tests/health.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// buildApp does not exist yet — this test will fail until Step 10
const { buildApp } = await import('../src/app.js');

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; timestamp: string }>();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 10: Install server dependencies**

Run: `pnpm --filter server install`

Expected: no errors.

- [ ] **Step 11: Run the test — it should fail**

Run: `pnpm --filter server test`

Expected: fail with `Cannot find module '../src/app.js'` (or similar import error). Confirms the test is real.

- [ ] **Step 12: Create `packages/server/src/app.ts`** (makes the test pass)

```typescript
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerCors } from './plugins/cors.js';
import { registerSensible } from './plugins/sensible.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(opts);

  await registerCors(app);
  await registerSensible(app);
  await app.register(healthRoutes);

  return app;
}
```

- [ ] **Step 13: Create `packages/server/src/index.ts`**

```typescript
import { buildApp } from './app.js';
import { env } from './env.js';

const app = await buildApp({
  logger:
    env.NODE_ENV === 'test'
      ? false
      : {
          level: env.NODE_ENV === 'production' ? 'info' : 'debug',
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
        },
});

await app.listen({ port: env.PORT, host: '0.0.0.0' });
```

- [ ] **Step 14: Run the test — it should pass**

Run: `pnpm --filter server test`

Expected:
```
✓ tests/health.test.ts > GET /health > returns 200 with status ok

Test Files  1 passed (1)
Tests       1 passed (1)
```

- [ ] **Step 15: Typecheck**

Run: `pnpm --filter server typecheck`

Expected: exits 0, no errors.

- [ ] **Step 16: Commit**

```bash
git add packages/server/
git commit -m "feat(server): scaffold Fastify app with health endpoint"
```

---

## Task 4: Server — Drizzle Schema + Database Connection

**Files:**
- Create: `packages/server/src/db/schema.pg.ts`
- Create: `packages/server/src/db/schema.sqlite.ts`
- Create: `packages/server/src/db/index.ts`
- Create: `packages/server/drizzle.config.ts`

- [ ] **Step 1: Create `packages/server/src/db/schema.pg.ts`**

```typescript
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
    .references(() => users.id),
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
      .references(() => games.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
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
      .references(() => gamePlayers.id),
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
    .references(() => gamePlayers.id),
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
  fetchedAt: timestamp('fetched_at').notNull(),
});
```

- [ ] **Step 2: Create `packages/server/src/db/schema.sqlite.ts`**

```typescript
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
```

- [ ] **Step 3: Create `packages/server/src/db/index.ts`**

```typescript
import { env } from '../env.js';

async function createDatabase() {
  if (env.DATABASE_URL.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const schema = await import('./schema.pg.js');
    const client = postgres(env.DATABASE_URL);
    return drizzle(client, { schema });
  } else {
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const Database = (await import('better-sqlite3')).default;
    const schema = await import('./schema.sqlite.js');
    const dbUrl = env.DATABASE_URL === ':memory:' ? ':memory:' : env.DATABASE_URL;
    const client = new Database(dbUrl);
    client.pragma('journal_mode = WAL');
    client.pragma('foreign_keys = ON');
    return drizzle(client, { schema });
  }
}

export const db = await createDatabase();
export type Db = typeof db;
```

- [ ] **Step 4: Create `packages/server/drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit';

const url = process.env['DATABASE_URL'] ?? './dev.db';
const isPg = url.startsWith('postgres');

export default defineConfig({
  schema: isPg ? './src/db/schema.pg.ts' : './src/db/schema.sqlite.ts',
  out: './drizzle',
  dialect: isPg ? 'postgresql' : 'sqlite',
  dbCredentials: { url },
});
```

- [ ] **Step 5: Typecheck with schema files**

Run: `pnpm --filter server typecheck`

Expected: exits 0, no errors.

- [ ] **Step 6: Generate SQLite migrations (dev dialect)**

Run: `DATABASE_URL=./dev.db pnpm --filter server db:generate`

Expected: `packages/server/drizzle/` directory created with an `*.sql` file.

Verify the file exists: `ls packages/server/drizzle/`

Expected: one file like `0000_initial.sql` containing CREATE TABLE statements.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/ packages/server/drizzle.config.ts packages/server/drizzle/
git commit -m "feat(server): add Drizzle schema for all entities (PostgreSQL + SQLite)"
```

---

## Task 5: Frontend — React + Vite + Tailwind + ShadCN Skeleton

**Files:**
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/tailwind.config.ts`
- Create: `packages/frontend/postcss.config.ts`
- Create: `packages/frontend/components.json`
- Create: `packages/frontend/index.html`
- Create: `packages/frontend/src/vite-env.d.ts`
- Create: `packages/frontend/src/index.css`
- Create: `packages/frontend/tests/setup.ts`
- Create: `packages/frontend/tests/App.test.tsx`  ← write BEFORE App.tsx
- Create: `packages/frontend/src/App.tsx`
- Create: `packages/frontend/src/main.tsx`

- [ ] **Step 1: Create `packages/frontend/package.json`**

```json
{
  "name": "@markettrader/frontend",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests"
  },
  "dependencies": {
    "@markettrader/shared": "workspace:*",
    "@tanstack/react-query": "^5.0.0",
    "lightweight-charts": "^4.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.26.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/frontend/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "useDefineForClassFields": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `packages/frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/frontend/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        border: 'hsl(var(--border))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Create `packages/frontend/postcss.config.ts`**

```typescript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `packages/frontend/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 7: Create `packages/frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MarketTrader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `packages/frontend/src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 9: Create `packages/frontend/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --border: 214.3 31.8% 91.4%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --border: 217.2 32.6% 17.5%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 10: Create `packages/frontend/tests/setup.ts`**

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 11: Write the failing test FIRST**

Create `packages/frontend/tests/App.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

describe('App', () => {
  it('renders the MarketTrader heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /markettrader/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 12: Install frontend dependencies**

Run: `pnpm --filter frontend install`

Expected: no errors.

- [ ] **Step 13: Run the test — it should fail**

Run: `pnpm --filter frontend test`

Expected: fail with `Cannot find module '../src/App'`.

- [ ] **Step 14: Create `packages/frontend/src/App.tsx`** (makes the test pass)

```tsx
function App() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">MarketTrader</h1>
        <p className="mt-2 text-muted-foreground">Virtual stock trading tournaments</p>
      </div>
    </main>
  );
}

export default App;
```

- [ ] **Step 15: Create `packages/frontend/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 16: Run the test — it should pass**

Run: `pnpm --filter frontend test`

Expected:
```
✓ tests/App.test.tsx > App > renders the MarketTrader heading

Test Files  1 passed (1)
Tests       1 passed (1)
```

- [ ] **Step 17: Verify frontend builds**

Run: `pnpm --filter frontend build`

Expected: `packages/frontend/dist/` created, no TypeScript or Vite errors.

- [ ] **Step 18: Commit**

```bash
git add packages/frontend/
git commit -m "feat(frontend): scaffold React + Vite app with Tailwind CSS and ShadCN"
```

---

## Task 6: Docker + Deployment Files

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile.server`
- Create: `.env.example`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: markettrader
      POSTGRES_PASSWORD: markettrader
      POSTGRES_DB: markettrader
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U markettrader']
      interval: 5s
      timeout: 5s
      retries: 5

  server:
    build:
      context: .
      dockerfile: Dockerfile.server
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://markettrader:markettrader@db:5432/markettrader
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      PORT: 3000
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost:5173}
      NODE_ENV: production
    ports:
      - '3000:3000'

volumes:
  postgres_data:
```

- [ ] **Step 2: Create `Dockerfile.server`**

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/server/ ./packages/server/

RUN pnpm --filter shared build
RUN pnpm --filter server build

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
```

- [ ] **Step 3: Create `.env.example`**

```dotenv
# Database
# PostgreSQL (production / Docker):
# DATABASE_URL=postgres://markettrader:markettrader@localhost:5432/markettrader
# SQLite (development — no Docker needed):
DATABASE_URL=./dev.db

# Auth — generate with: openssl rand -hex 32
JWT_SECRET=replace-with-random-64-char-hex-string

# Server
PORT=3000
NODE_ENV=development

# Frontend URL (for CORS)
CORS_ORIGIN=http://localhost:5173

# Stock price provider: yahoo | alpaca | polygon
STOCK_PROVIDER=yahoo

# Required only if STOCK_PROVIDER=alpaca
# ALPACA_API_KEY=your-alpaca-api-key-here
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml Dockerfile.server .env.example
git commit -m "chore: add Docker Compose for local dev and production Dockerfile"
```

---

## Task 7: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    name: Typecheck · Lint · Test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build shared types
        run: pnpm --filter shared build

      - name: Typecheck all packages
        run: pnpm typecheck

      - name: Lint all packages
        run: pnpm lint

      - name: Run tests
        run: pnpm test
        env:
          DATABASE_URL: ':memory:'
          JWT_SECRET: 'ci-test-secret-not-used-in-production'
          NODE_ENV: test
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "ci: add GitHub Actions workflow for typecheck, lint, and test"
```

---

## Task 8: Final Integration Check

- [ ] **Step 1: Full install from root**

Run: `pnpm install`

Expected: no errors.

- [ ] **Step 2: Build shared types**

Run: `pnpm --filter shared build`

Expected: `packages/shared/dist/` populated.

- [ ] **Step 3: Run all tests**

Run: `DATABASE_URL=:memory: pnpm test`

Expected:
```
✓ packages/server/tests/health.test.ts (1 test)
✓ packages/frontend/tests/App.test.tsx (1 test)
Test Suites: 2 passed
Tests:       2 passed
```

- [ ] **Step 4: Typecheck all packages**

Run: `pnpm typecheck`

Expected: all three packages pass with 0 errors.

- [ ] **Step 5: Build all packages**

Run: `pnpm build`

Expected: `packages/shared/dist/`, `packages/server/dist/`, `packages/frontend/dist/` all created.

- [ ] **Step 6: Smoke-test server startup with SQLite**

Run (in one terminal):
```bash
DATABASE_URL=./dev.db pnpm --filter server db:generate
DATABASE_URL=./dev.db node packages/server/dist/index.js &
SERVER_PID=$!
sleep 1
curl -s http://localhost:3000/health
kill $SERVER_PID
rm -f dev.db
```

Expected output from curl: `{"status":"ok","timestamp":"2026-..."}`

- [ ] **Step 7: Verify .gitignore covers generated files**

Run: `git status`

Expected: clean — `dev.db`, `dist/`, `drizzle/` are all ignored.

- [ ] **Step 8: Final commit if anything was missed**

```bash
git log --oneline
```

Expected log:
```
ci: add GitHub Actions workflow for typecheck, lint, and test
chore: add Docker Compose for local dev and production Dockerfile
feat(frontend): scaffold React + Vite app with Tailwind CSS and ShadCN
feat(server): add Drizzle schema for all entities (PostgreSQL + SQLite)
feat(server): scaffold Fastify app with health endpoint
feat(shared): add TypeScript API contract types
chore: initialize pnpm monorepo workspace
Initial commit
```

---

## Verification Checklist

After all tasks complete, the following must be true:

| Check | Command | Expected |
|---|---|---|
| Install | `pnpm install` | No errors |
| Shared build | `pnpm --filter shared build` | `dist/` created |
| All tests | `DATABASE_URL=:memory: pnpm test` | 2 tests pass |
| Typecheck | `pnpm typecheck` | 0 errors in all 3 packages |
| Full build | `pnpm build` | All 3 packages compile |
| DB migrations | `DATABASE_URL=./dev.db pnpm --filter server db:generate` | `drizzle/*.sql` created |
| Server smoke | `curl localhost:3000/health` | `{"status":"ok"}` |

---

## Next Plans

- `2026-05-08-auth-api.md` — `POST /auth/register`, `POST /auth/login`, JWT middleware, argon2 hashing
- `2026-05-08-game-api.md` — Games CRUD, join game, leaderboard endpoint
- `2026-05-08-trading-api.md` — Portfolio, trade execution, pluggable stock price provider
- `2026-05-08-websocket.md` — WebSocket server, per-game channels, price broadcasting
- `2026-05-08-frontend-features.md` — Auth pages, game pages, trading UI, TradingView charts
