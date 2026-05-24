import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { db as globalDb, type Db } from './db/index.js';
import { registerCors } from './plugins/cors.js';
import { registerSensible } from './plugins/sensible.js';
import { registerCookie } from './plugins/cookie.js';
import { registerJwt } from './plugins/jwt.js';
import { registerHelmet } from './plugins/helmet.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerWebsocket } from './plugins/websocket.js';
import { registerSwagger } from './plugins/swagger.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/games.js';
import { publicGamesRoutes } from './routes/public-games.js';
import { stockRoutes } from './routes/stocks.js';
import { tradingRoutes } from './routes/trading.js';
import { marketStatusRoutes } from './routes/market-status.js';
import { watchlistRoutes } from './routes/watchlists.js';
import { adminRoutes } from './routes/admin/index.js';
import { registerAdminGuard } from './plugins/admin-guard.js';
import { SystemSettingsService } from './services/system-settings.js';
import { systemSettingsRoutes } from './routes/system-settings.js';
import type { StockProvider } from './providers/index.js';
import { CachedProvider, createProvider } from './providers/index.js';
import type { MarketStatusProvider } from './providers/market-status/index.js';
import {
  CachedMarketStatus,
  createMarketStatusProvider,
} from './providers/market-status/index.js';
import { env } from './env.js';
import { GameClientRegistry } from './ws/registry.js';
import { GlobalClientRegistry } from './ws/global-registry.js';
import { liveRoute } from './ws/live-route.js';
import { globalLiveRoute } from './ws/global-live-route.js';
import { IndicesBroadcaster } from './ws/indices-broadcaster.js';
import { startPricePoller } from './ws/price-poller.js';
import { startPendingOrdersWorker } from './workers/pending-orders.js';
import { startPortfolioSnapshotWorker } from './workers/portfolio-snapshot.js';
import { attachSentry } from './observability/sentry.js';
import { EventBus } from './events/bus.js';
import { AchievementEngine } from './achievements/engine.js';
import { achievements as achievementDefinitions } from './achievements/definitions/index.js';
import { achievementsRoutes } from './routes/achievements.js';
import { adminAchievementsRoutes } from './routes/admin/achievements.js';

export async function buildApp(
  opts: FastifyServerOptions & {
    db?: Db;
    provider?: StockProvider;
    marketStatusProvider?: MarketStatusProvider;
    disablePoller?: boolean;
    /** When true, registers the rate-limit plugin with no real ceiling. Tests only. */
    disableRateLimit?: boolean;
    /** Override leaderboard broadcast throttle in ms. Defaults to 1000. Pass 0 in tests. */
    leaderboardThrottleMs?: number;
  } = {},
): Promise<FastifyInstance> {
  const {
    db = globalDb,
    provider: injectedProvider,
    marketStatusProvider: injectedMarketStatus,
    disablePoller = false,
    disableRateLimit = false,
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
  await registerRateLimit(app, { disabled: disableRateLimit });
  await registerSwagger(app);

  const registry = new GameClientRegistry();
  const globalRegistry = new GlobalClientRegistry();

  const systemSettings = new SystemSettingsService(db);
  await systemSettings.ensureSeeded();

  // In-process event bus + achievement engine. Construct before route
  // registration so route factories can capture the bus reference.
  const bus = new EventBus();
  bus.setLogger(app.log);
  const achievementEngine = new AchievementEngine(
    db,
    bus,
    registry,
    systemSettings,
    achievementDefinitions,
    app.log,
  );
  achievementEngine.start();
  app.addHook('onClose', async () => {
    achievementEngine.stop();
  });

  const indicesBroadcaster = new IndicesBroadcaster(provider, systemSettings, globalRegistry);
  if (!disablePoller) {
    await indicesBroadcaster.start();
  }
  app.addHook('onClose', async () => {
    indicesBroadcaster.stop();
  });

  // Fan ticker-tape config changes out to every connected /ws/live client so
  // the frontend can invalidate its cached symbol list without polling.
  systemSettings.on('change', (symbols: string[]) => {
    globalRegistry.broadcast({
      event: 'ticker_tape_config_changed',
      data: { symbols, at: new Date().toISOString() },
    });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes(db));
  await app.register(gameRoutes(db, bus));
  await app.register(publicGamesRoutes(db));
  await app.register(stockRoutes(db, provider));
  await app.register(
    tradingRoutes(db, provider, marketStatusProvider, registry, leaderboardThrottleMs, bus),
  );
  await app.register(marketStatusRoutes(marketStatusProvider));
  await app.register(watchlistRoutes(db));
  await app.register(systemSettingsRoutes(systemSettings));
  await app.register(achievementsRoutes(db, achievementEngine));
  await registerAdminGuard(app, db);
  await app.register(adminRoutes(db, provider, systemSettings));
  await app.register(adminAchievementsRoutes(db, achievementEngine, systemSettings));
  await app.register(liveRoute(db, registry, achievementEngine));
  await app.register(globalLiveRoute(globalRegistry));

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
        bus,
        logger: app.log,
      });
      app.addHook('onClose', async () => {
        pendingWorker.stop();
      });
    }

    const snapshotWorker = startPortfolioSnapshotWorker({
      db,
      bus,
      logger: app.log,
    });
    app.addHook('onClose', async () => {
      snapshotWorker.stop();
    });

    // Engine tick: feeds time-based achievements without external triggers.
    // Cheap because the bus skips event types nobody listens to.
    const tickHandle = setInterval(() => {
      void bus.emit({ type: 'engine.tick', at: new Date().toISOString() });
    }, 60_000);
    app.addHook('onClose', async () => {
      clearInterval(tickHandle);
    });
  }

  attachSentry(app);

  return app;
}
