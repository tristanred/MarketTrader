import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { db as globalDb, type Db } from './db/index.js';
import { registerCors } from './plugins/cors.js';
import { registerSensible } from './plugins/sensible.js';
import { registerCookie } from './plugins/cookie.js';
import { registerJwt } from './plugins/jwt.js';
import { registerHelmet } from './plugins/helmet.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerWebsocket } from './plugins/websocket.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/games.js';
import { stockRoutes } from './routes/stocks.js';
import { tradingRoutes } from './routes/trading.js';
import { marketStatusRoutes } from './routes/market-status.js';
import { watchlistRoutes } from './routes/watchlists.js';
import type { StockProvider } from './providers/index.js';
import { CachedProvider, createProvider } from './providers/index.js';
import type { MarketStatusProvider } from './providers/market-status/index.js';
import {
  CachedMarketStatus,
  createMarketStatusProvider,
} from './providers/market-status/index.js';
import { env } from './env.js';
import { GameClientRegistry } from './ws/registry.js';
import { liveRoute } from './ws/live-route.js';
import { startPricePoller } from './ws/price-poller.js';
import { startPendingOrdersWorker } from './workers/pending-orders.js';
import { attachSentry } from './observability/sentry.js';

export async function buildApp(
  opts: FastifyServerOptions & {
    db?: Db;
    provider?: StockProvider;
    marketStatusProvider?: MarketStatusProvider;
    disablePoller?: boolean;
    /** Override leaderboard broadcast throttle in ms. Defaults to 1000. Pass 0 in tests. */
    leaderboardThrottleMs?: number;
  } = {},
): Promise<FastifyInstance> {
  const {
    db = globalDb,
    provider: injectedProvider,
    marketStatusProvider: injectedMarketStatus,
    disablePoller = false,
    leaderboardThrottleMs,
    ...fastifyOpts
  } = opts;
  const provider = injectedProvider ?? new CachedProvider(db, createProvider());
  const marketStatusProvider =
    injectedMarketStatus ??
    new CachedMarketStatus(
      createMarketStatusProvider(provider),
      env.MARKET_STATUS_CACHE_TTL_MS,
    );
  const app = Fastify(fastifyOpts);

  // @fastify/websocket MUST be registered before any routes
  await registerWebsocket(app);

  await registerCors(app);
  await registerHelmet(app);
  await registerSensible(app);
  await registerCookie(app);
  await registerJwt(app);
  await registerRateLimit(app);

  const registry = new GameClientRegistry();

  await app.register(healthRoutes);
  await app.register(authRoutes(db));
  await app.register(gameRoutes(db));
  await app.register(stockRoutes(db, provider));
  await app.register(
    tradingRoutes(db, provider, marketStatusProvider, registry, leaderboardThrottleMs),
  );
  await app.register(marketStatusRoutes(marketStatusProvider));
  await app.register(watchlistRoutes(db));
  await app.register(liveRoute(db, registry));

  if (!disablePoller) {
    const handle = startPricePoller(db, provider, registry);
    app.addHook('onClose', async () => {
      clearInterval(handle);
    });

    if (env.MARKET_HOURS_MODE === 'pending') {
      const pendingWorker = startPendingOrdersWorker({
        db,
        provider,
        marketStatusProvider,
        registry,
        logger: app.log,
      });
      app.addHook('onClose', async () => {
        pendingWorker.stop();
      });
    }
  }

  attachSentry(app);

  return app;
}
