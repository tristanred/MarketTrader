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
import { createLimits } from './limits/index.js';
import { rateDenialLabel } from './limits/rate.js';
import { registerLimitErrorHandler } from './limits/errors.js';
import { UsageTracker } from './limits/usage-tracker.js';
import { flushUsage } from './limits/usage-store.js';
import { recordRateLimitDenial, recordUnrecordedDenial, registerUsageHooks } from './limits/usage-hooks.js';
import { healthRoutes } from './routes/health.js';
import { versionRoutes } from './routes/version.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/games.js';
import { publicGamesRoutes } from './routes/public-games.js';
import { stockRoutes } from './routes/stocks.js';
import { tradingRoutes } from './routes/trading.js';
import { marketStatusRoutes } from './routes/market-status.js';
import { watchlistRoutes } from './routes/watchlists.js';
import { discoverRoutes } from './routes/discover.js';
import { adminRoutes } from './routes/admin/index.js';
import { registerAdminGuard } from './plugins/admin-guard.js';
import { SystemSettingsService } from './services/system-settings.js';
import { ConfigOverridesService } from './services/config-overrides.js';
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
import { startWsHeartbeat } from './ws/heartbeat.js';
import { startPricePoller } from './ws/price-poller.js';
import { startPendingOrdersWorker } from './workers/pending-orders.js';
import { startPortfolioSnapshotWorker } from './workers/portfolio-snapshot.js';
import { startDiscoverWorker } from './workers/discover.js';
import { startUsageRollupWorker } from './workers/usage-rollup.js';
import { attachErrorCapture } from './observability/error-capture.js';
import { registerOtel } from './plugins/otel.js';
import { EventBus } from './events/bus.js';
import { AchievementEngine } from './achievements/engine.js';
import { registerAnalytics } from './observability/analytics.js';
import { getPostHog, type AnalyticsClient } from './observability/posthog.js';
import { achievements as achievementDefinitions } from './achievements/definitions/index.js';
import { achievementsRoutes } from './routes/achievements.js';
import { FailedLoginTracker, type FailedLoginOptions } from './services/failed-login.js';
import { adminAchievementsRoutes } from './routes/admin/achievements.js';
import { RuntimeConfig } from './config/runtime-config.js';

export async function buildApp(
  opts: FastifyServerOptions & {
    db?: Db;
    provider?: StockProvider;
    marketStatusProvider?: MarketStatusProvider;
    disablePoller?: boolean;
    /** When true, registers the rate-limit plugin with no real ceiling. Tests only. */
    disableRateLimit?: boolean;
    /** Pass `{ disabled: true }` in tests; thresholds come from `runtimeConfig`. */
    loginThrottle?: FailedLoginOptions;
    /** Override leaderboard broadcast throttle in ms. Defaults to 1000. Pass 0 in tests. */
    leaderboardThrottleMs?: number;
    /** PostHog client for analytics and error tracking. Defaults to {@link getPostHog}. */
    analytics?: AnalyticsClient | null;
    /** Live options for this app instance. Defaults to the process environment. */
    runtimeConfig?: RuntimeConfig;
    /** Request/denial counters for this app. Tests inject one to inspect it. */
    usageTracker?: UsageTracker;
    /** Pass `{ disabled: true }` to lift every per-user limit. Tests only. */
    limits?: { disabled?: boolean };
  } = {},
): Promise<FastifyInstance> {
  const {
    db = globalDb,
    provider: injectedProvider,
    marketStatusProvider: injectedMarketStatus,
    disablePoller = false,
    disableRateLimit = false,
    loginThrottle,
    leaderboardThrottleMs,
    analytics = getPostHog(),
    runtimeConfig = RuntimeConfig.fromEnvironment(),
    usageTracker = new UsageTracker(),
    limits: limitOptions = {},
    ...fastifyOpts
  } = opts;
  const provider = injectedProvider ?? new CachedProvider(db, createProvider(runtimeConfig), runtimeConfig);
  const marketStatusProvider =
    injectedMarketStatus ??
    new CachedMarketStatus(
      createMarketStatusProvider(provider),
      () => runtimeConfig.get('MARKET_STATUS_CACHE_TTL_MS'),
    );
  const app = Fastify(fastifyOpts);

  // @fastify/websocket MUST be registered before any routes
  await registerWebsocket(app);

  // ...and @fastify/otel MUST come before them too — it only instruments
  // routes declared after it, so a later registration silently loses coverage
  // for everything above it.
  await registerOtel(app);

  await registerCors(app);
  await registerHelmet(app);
  await registerSensible(app);
  await registerCookie(app);
  await registerJwt(app, db);
  await registerRateLimit(app, {
    disabled: disableRateLimit,
    // Info, not warn: warn ships to PostHog, which bills by volume, and a
    // script hammering a limit would turn into a bill.
    onExceeded: (request) => {
      request.log.info(
        { limit: rateDenialLabel(request), ip: request.ip, userId: request.account?.id },
        'rate limit exceeded',
      );
      recordRateLimitDenial(usageTracker, request);
    },
  });
  await registerSwagger(app);
  // Before any route plugin: route contexts inherit the error handler at registration.
  registerLimitErrorHandler(app, runtimeConfig, (request, err) => recordUnrecordedDenial(usageTracker, request, err));

  const registry = new GameClientRegistry();
  const globalRegistry = new GlobalClientRegistry();

  const systemSettings = new SystemSettingsService(db);
  await systemSettings.ensureSeeded();

  // Before any worker arms a timer, so their first reads already see the
  // persisted overrides.
  const configOverrides = new ConfigOverridesService(db, runtimeConfig);
  const activeOverrides = await configOverrides.load(app.log);
  if (activeOverrides.length > 0) {
    app.log.warn(
      { keys: activeOverrides },
      'runtime config overrides active; they take precedence over the environment until reset in /admin/config',
    );
  }

  // After overrides load, so the first resolved limit already reflects them.
  const limits = createLimits({
    db,
    config: runtimeConfig,
    tracker: usageTracker,
    ...(limitOptions.disabled !== undefined ? { disabled: limitOptions.disabled } : {}),
  });
  app.decorate('limits', limits);
  // Root-level, before every route: the ceiling and the usage counters must
  // cover each route registered below.
  registerUsageHooks(app, limits);

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

  const stopAnalytics = registerAnalytics(bus, db, analytics);
  app.addHook('onClose', async () => {
    stopAnalytics();
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
  await app.register(versionRoutes);
  await app.register(authRoutes(db, new FailedLoginTracker(runtimeConfig, loginThrottle), limits));
  await app.register(gameRoutes(db, limits, bus));
  await app.register(publicGamesRoutes(db));
  await app.register(stockRoutes(db, provider, runtimeConfig));
  await app.register(
    tradingRoutes(db, provider, marketStatusProvider, runtimeConfig, limits, registry, leaderboardThrottleMs, bus),
  );
  await app.register(marketStatusRoutes(marketStatusProvider, runtimeConfig));
  await app.register(watchlistRoutes(db, limits));
  await app.register(discoverRoutes(db));
  await app.register(systemSettingsRoutes(systemSettings));
  await app.register(achievementsRoutes(db, achievementEngine));
  // One count for both the WS upgrade cap and the admin usage view, so they cannot disagree.
  const countUserSockets = (userId: string): number =>
    registry.countForUser(userId) + globalRegistry.countForUser(userId);
  await registerAdminGuard(app, db);
  await app.register(
    adminRoutes(db, provider, systemSettings, configOverrides, limits, countUserSockets, bus, registry),
  );
  await app.register(adminAchievementsRoutes(db, achievementEngine, systemSettings));
  const wsLimits = { limits, config: runtimeConfig, countUserSockets };
  await app.register(
    liveRoute(db, registry, achievementEngine, env.WS_REVALIDATE_INTERVAL_MS, wsLimits),
  );
  await app.register(globalLiveRoute(db, globalRegistry, env.WS_REVALIDATE_INTERVAL_MS, wsLimits));

  if (!disablePoller) {
    // Keeps idle sockets from being reaped by an intermediary, and reaps peers
    // that vanished without a close frame.
    const heartbeat = startWsHeartbeat(
      function* () {
        yield* registry.sockets();
        yield* globalRegistry.sockets();
      },
      { intervalMs: env.WS_HEARTBEAT_INTERVAL_MS },
    );
    app.addHook('onClose', async () => {
      heartbeat.stop();
    });

    const poller = startPricePoller(db, provider, registry, runtimeConfig, app.log);
    app.addHook('onClose', async () => {
      await poller.stop();
    });

    // Runs in every mode, not only `pending`: the same tick fills resting
    // limit/stop/bracket orders and expires day orders, and MARKET_HOURS_MODE
    // can change at runtime, so pending rows may exist under any mode.
    const pendingWorker = startPendingOrdersWorker({
      db,
      provider,
      marketStatusProvider,
      registry,
      bus,
      config: runtimeConfig,
      logger: app.log,
    });
    app.addHook('onClose', async () => {
      await pendingWorker.stop();
    });

    const snapshotWorker = startPortfolioSnapshotWorker({
      db,
      bus,
      config: runtimeConfig,
      logger: app.log,
    });
    app.addHook('onClose', async () => {
      await snapshotWorker.stop();
    });

    const discoverWorker = startDiscoverWorker({ db, provider, config: runtimeConfig, logger: app.log });
    app.addHook('onClose', async () => {
      await discoverWorker.stop();
    });

    const tracker = limits.tracker;
    const usageWorker = startUsageRollupWorker({ db, tracker, config: runtimeConfig, logger: app.log });
    app.addHook('onClose', async () => {
      await usageWorker.stop();
      // Counts gathered since the last tick; a graceful shutdown loses nothing.
      await flushUsage(db, tracker.swap());
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

  attachErrorCapture(app, analytics);

  return app;
}
