import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { adminUsersRoutes } from './users.js';
import { adminGamesRoutes } from './games.js';

/**
 * Composes every `/admin/*` sub-route into one plugin. The caller (app.ts) is
 * responsible for first registering `registerAdminGuard(app, db)` so each
 * route can attach `rawApp.requireAdmin` as its `onRequest` pre-handler.
 */
export function adminRoutes(db: Db) {
  return async function (app: FastifyInstance): Promise<void> {
    await app.register(adminUsersRoutes(db));
    await app.register(adminGamesRoutes(db));
  };
}
