import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';

const listQuery = z.object({
  action: z.string().optional(),
  targetType: z.enum(['user', 'game', 'trade', 'portfolio', 'system']).optional(),
  targetId: z.string().optional(),
  adminUserId: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

function safeParse(v: string | null): unknown {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/**
 * Registers GET /admin/audit. Filters: action, targetType, targetId,
 * adminUserId, since, until. Returns paginated rows with parsed JSON for
 * before/after/metadata. Append-only — there is no write/delete endpoint.
 */
export function adminAuditRoutes(db: Db) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { adminAuditLog, users } = schema;

    app.get('/admin/audit', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Read the admin audit log (paginated, filterable).', security: [{ bearerAuth: [] }], querystring: listQuery },
    }, async (request, reply) => {
      const { action, targetType, targetId, adminUserId, since, until, limit, offset } = request.query;
      const conds = [
        action ? eq(adminAuditLog.action, action) : undefined,
        targetType ? eq(adminAuditLog.targetType, targetType) : undefined,
        targetId ? eq(adminAuditLog.targetId, targetId) : undefined,
        adminUserId ? eq(adminAuditLog.adminUserId, adminUserId) : undefined,
        since ? gte(adminAuditLog.createdAt, since) : undefined,
        until ? lte(adminAuditLog.createdAt, until) : undefined,
      ].filter((c) => c !== undefined);
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

      const rows = await db
        .select({
          id: adminAuditLog.id,
          adminUserId: adminAuditLog.adminUserId,
          adminUsername: users.username,
          action: adminAuditLog.action,
          targetType: adminAuditLog.targetType,
          targetId: adminAuditLog.targetId,
          before: adminAuditLog.before,
          after: adminAuditLog.after,
          metadata: adminAuditLog.metadata,
          createdAt: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .leftJoin(users, eq(adminAuditLog.adminUserId, users.id))
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit)
        .offset(offset);

      const totalRow = await db.select({ c: count() }).from(adminAuditLog).where(where);

      return reply.status(200).send({
        entries: rows.map((r) => ({
          ...r,
          before: safeParse(r.before),
          after: safeParse(r.after),
          metadata: safeParse(r.metadata),
        })),
        total: Number(totalRow[0]?.c ?? 0),
      });
    });
  };
}
