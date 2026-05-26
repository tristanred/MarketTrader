import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import type { StockProvider } from '../../providers/index.js';
import type { SystemSettingsService } from '../../services/system-settings.js';
import type { EventBus } from '../../events/bus.js';
import { adminUsersRoutes } from './users.js';
import { adminGamesRoutes } from './games.js';
import { adminPortfoliosRoutes } from './portfolios.js';
import { adminTradesRoutes } from './trades.js';
import { adminSystemRoutes } from './system.js';
import { adminAuditRoutes } from './audit.js';

/**
 * Composes every `/admin/*` sub-route into one plugin. The caller (app.ts) is
 * responsible for first registering `registerAdminGuard(app, db)` so each
 * route can attach `rawApp.requireAdmin` as its `onRequest` pre-handler.
 *
 * `bus` is forwarded to `adminTradesRoutes` so admin-driven `force-execute`
 * emits `trade.executed` on the in-process domain bus (achievement engine,
 * etc.). Optional so tests that don't need bus side-effects can omit it.
 */
export function adminRoutes(
  db: Db,
  provider: StockProvider,
  systemSettings: SystemSettingsService,
  bus?: EventBus,
) {
  return async function (app: FastifyInstance): Promise<void> {
    await app.register(adminUsersRoutes(db));
    await app.register(adminGamesRoutes(db));
    await app.register(adminPortfoliosRoutes(db, provider));
    await app.register(adminTradesRoutes(db, provider, bus));
    await app.register(adminSystemRoutes(db, systemSettings));
    await app.register(adminAuditRoutes(db));
  };
}
