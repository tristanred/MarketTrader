import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import type { StockProvider } from '../../providers/index.js';
import type { SystemSettingsService } from '../../services/system-settings.js';
import type { ConfigOverridesService } from '../../services/config-overrides.js';
import type { EventBus } from '../../events/bus.js';
import type { GameClientRegistry } from '../../ws/registry.js';
import type { Limits } from '../../limits/index.js';
import { adminUsersRoutes } from './users.js';
import { adminGamesRoutes } from './games.js';
import { adminPortfoliosRoutes } from './portfolios.js';
import { adminTradesRoutes } from './trades.js';
import { adminSystemRoutes } from './system.js';
import { adminAuditRoutes } from './audit.js';
import { adminConfigRoutes } from './config.js';
import { adminLimitsRoutes } from './limits.js';

/**
 * Composes every `/admin/*` sub-route into one plugin. The caller (app.ts) is
 * responsible for first registering `registerAdminGuard(app, db)` so each
 * route can attach `rawApp.requireAdmin` as its `onRequest` pre-handler.
 *
 * `configOverrides` backs `/admin/config` and must be the service that loaded
 * this app's runtime config, so an override lands on the config the app reads.
 * `limits` and `wsConnectionCount` back `/admin/limits` and
 * `/admin/users/:id/limits`; the counter reads the live socket registries.
 *
 * `bus` is forwarded to `adminTradesRoutes` so admin-driven `force-execute`
 * emits `trade.executed` on the in-process domain bus (achievement engine,
 * etc.). `registry` lets the same handler broadcast the matching
 * `trade_executed` WS frame to game clients. Both optional so tests that
 * don't need those side-effects can omit them.
 */
export function adminRoutes(
  db: Db,
  provider: StockProvider,
  systemSettings: SystemSettingsService,
  configOverrides: ConfigOverridesService,
  limits: Limits,
  wsConnectionCount: (userId: string) => number,
  bus?: EventBus,
  registry?: GameClientRegistry,
) {
  return async function (app: FastifyInstance): Promise<void> {
    await app.register(adminUsersRoutes(db));
    await app.register(adminGamesRoutes(db));
    await app.register(adminPortfoliosRoutes(db, provider));
    await app.register(adminTradesRoutes(db, provider, bus, registry));
    await app.register(adminSystemRoutes(db, systemSettings));
    await app.register(adminConfigRoutes(configOverrides));
    await app.register(adminLimitsRoutes(db, limits, wsConnectionCount));
    await app.register(adminAuditRoutes(db));
  };
}
