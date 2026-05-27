import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { recordAdminAction } from '../../services/admin-audit.js';
import type { AchievementEngine } from '../../achievements/engine.js';
import type { SystemSettingsService } from '../../services/system-settings.js';
import { getAdminAchievementsForGame } from '../../services/achievement.js';
import type { AchievementDefinitionDTO } from '@markettrader/shared';

const enabledBody = z.object({ enabled: z.boolean() });
const progressBody = z.object({ progress: z.number().int().nonnegative() });

const gameKeyParams = z.object({ gameId: z.string(), key: z.string() });
const globalKeyParams = z.object({ key: z.string() });
const playerKeyParams = z.object({
  gameId: z.string(),
  gamePlayerId: z.string(),
  key: z.string(),
});

/**
 * Admin routes for achievement management. All endpoints require admin and
 * write an `admin_audit_log` row via {@link recordAdminAction}. See
 * `2026-05-23-achievements-system-design.md` for the action-string spec.
 */
export function adminAchievementsRoutes(
  db: Db,
  engine: AchievementEngine,
  settings: SystemSettingsService,
) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { achievementProgress, gameAchievementOverrides, gamePlayers } = schema;

    // ── Global definitions list (system-page view) ────────────────────────────
    app.get(
      '/admin/achievements',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'List every achievement definition with its global enabled state.',
          security: [{ bearerAuth: [] }],
        },
      },
      async (_request, reply) => {
        const disabled = await settings.getDisabledAchievements();
        const definitions: AchievementDefinitionDTO[] = engine
          .listDefinitions()
          .map((d) => ({
            key: d.key,
            name: d.name,
            description: d.description,
            ...(d.category !== undefined && { category: d.category }),
            rarity: d.rarity,
            icon: d.icon,
            target: d.target,
            enabled: !disabled.has(d.key),
          }));
        return reply.status(200).send({ definitions });
      },
    );

    // ── List ──────────────────────────────────────────────────────────────────
    app.get(
      '/admin/games/:gameId/achievements',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'List achievement definitions + all progress rows for a game (orphans included).',
          security: [{ bearerAuth: [] }],
          params: z.object({ gameId: z.string() }),
        },
      },
      async (request, reply) => {
        const view = await getAdminAchievementsForGame(db, engine, request.params.gameId);
        return reply.status(200).send(view);
      },
    );

    // ── Per-player mutations ──────────────────────────────────────────────────
    app.post(
      '/admin/games/:gameId/players/:gamePlayerId/achievements/:key/unlock',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Force-unlock an achievement for a player.',
          security: [{ bearerAuth: [] }],
          params: playerKeyParams,
        },
      },
      async (request, reply) => {
        const { gameId, gamePlayerId, key } = request.params;
        const def = engine.getDefinition(key);
        if (!def) return reply.status(404).send({ error: 'Unknown achievement key' });

        const [player] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.id, gamePlayerId), eq(gamePlayers.gameId, gameId)))
          .limit(1);
        if (!player) return reply.status(404).send({ error: 'Player not in this game' });

        await ensureRow(db, gameId, gamePlayerId, key, def.target);
        const before = await readRow(db, gamePlayerId, key);
        const now = new Date().toISOString();
        // Preserve original unlock timestamp when re-unlocking an already-
        // unlocked row, so the audit trail and player-visible time match the
        // first unlock event.
        const unlockedAt = before?.unlockedAt ?? now;
        await db
          .update(achievementProgress)
          .set({ progress: def.target, unlockedAt, updatedAt: now })
          .where(
            and(
              eq(achievementProgress.gamePlayerId, gamePlayerId),
              eq(achievementProgress.achievementKey, key),
            ),
          );
        const after = await readRow(db, gamePlayerId, key);
        if (before?.unlockedAt == null && after?.unlockedAt != null) {
          engine.broadcastAchievementUnlock(gameId, gamePlayerId, key, after.unlockedAt);
        }
        await recordAdminAction(db, {
          adminUserId: request.user.id,
          action: 'achievement.unlock',
          targetType: 'game',
          targetId: gameId,
          before,
          after,
          metadata: { gamePlayerId, achievementKey: key },
        });
        return reply.status(200).send(after);
      },
    );

    app.post(
      '/admin/games/:gameId/players/:gamePlayerId/achievements/:key/reset',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Reset progress to 0 and clear unlockedAt.',
          security: [{ bearerAuth: [] }],
          params: playerKeyParams,
        },
      },
      async (request, reply) => {
        const { gameId, gamePlayerId, key } = request.params;
        const def = engine.getDefinition(key);
        if (!def) return reply.status(404).send({ error: 'Unknown achievement key' });

        await ensureRow(db, gameId, gamePlayerId, key, def.target);
        const before = await readRow(db, gamePlayerId, key);
        const resetAt = new Date().toISOString();
        await db
          .update(achievementProgress)
          .set({ progress: 0, unlockedAt: null, updatedAt: resetAt })
          .where(
            and(
              eq(achievementProgress.gamePlayerId, gamePlayerId),
              eq(achievementProgress.achievementKey, key),
            ),
          );
        const after = await readRow(db, gamePlayerId, key);
        await recordAdminAction(db, {
          adminUserId: request.user.id,
          action: 'achievement.reset',
          targetType: 'game',
          targetId: gameId,
          before,
          after,
          metadata: { gamePlayerId, achievementKey: key },
        });
        return reply.status(200).send(after);
      },
    );

    app.patch(
      '/admin/games/:gameId/players/:gamePlayerId/achievements/:key',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Set absolute progress; auto-unlocks when progress ≥ target.',
          security: [{ bearerAuth: [] }],
          params: playerKeyParams,
          body: progressBody,
        },
      },
      async (request, reply) => {
        const { gameId, gamePlayerId, key } = request.params;
        const { progress } = request.body;
        const def = engine.getDefinition(key);
        if (!def) return reply.status(404).send({ error: 'Unknown achievement key' });

        await ensureRow(db, gameId, gamePlayerId, key, def.target);
        const before = await readRow(db, gamePlayerId, key);
        const shouldUnlock = progress >= def.target;
        const now = new Date().toISOString();
        // Preserve original unlock timestamp on a re-unlock; null when the
        // new progress falls below target.
        const unlockedAt = shouldUnlock ? (before?.unlockedAt ?? now) : null;
        await db
          .update(achievementProgress)
          .set({
            progress,
            unlockedAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(achievementProgress.gamePlayerId, gamePlayerId),
              eq(achievementProgress.achievementKey, key),
            ),
          );
        const after = await readRow(db, gamePlayerId, key);
        if (before?.unlockedAt == null && after?.unlockedAt != null) {
          engine.broadcastAchievementUnlock(gameId, gamePlayerId, key, after.unlockedAt);
        }
        await recordAdminAction(db, {
          adminUserId: request.user.id,
          action: 'achievement.set_progress',
          targetType: 'game',
          targetId: gameId,
          before,
          after,
          metadata: { gamePlayerId, achievementKey: key },
        });
        return reply.status(200).send(after);
      },
    );

    // ── Per-game enable toggle ────────────────────────────────────────────────
    app.patch(
      '/admin/games/:gameId/achievements/:key',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Enable or disable a single achievement for one game (per-game override).',
          security: [{ bearerAuth: [] }],
          params: gameKeyParams,
          body: enabledBody,
        },
      },
      async (request, reply) => {
        const { gameId, key } = request.params;
        const { enabled } = request.body;
        if (!engine.getDefinition(key)) {
          return reply.status(404).send({ error: 'Unknown achievement key' });
        }
        const now = new Date().toISOString();
        await db
          .insert(gameAchievementOverrides)
          .values({ gameId, achievementKey: key, enabled, updatedAt: now })
          .onConflictDoUpdate({
            target: [gameAchievementOverrides.gameId, gameAchievementOverrides.achievementKey],
            set: { enabled, updatedAt: now },
          });
        engine.invalidateCache();
        await recordAdminAction(db, {
          adminUserId: request.user.id,
          action: 'achievement.set_enabled_game',
          targetType: 'game',
          targetId: gameId,
          after: { enabled },
          metadata: { achievementKey: key },
        });
        return reply.status(200).send({ gameId, key, enabled });
      },
    );

    // ── Global enable toggle ──────────────────────────────────────────────────
    app.patch(
      '/admin/achievements/:key',
      {
        onRequest: rawApp.requireAdmin,
        schema: {
          tags: ['Admin'],
          summary: 'Enable or disable an achievement platform-wide.',
          security: [{ bearerAuth: [] }],
          params: globalKeyParams,
          body: enabledBody,
        },
      },
      async (request, reply) => {
        const { key } = request.params;
        const { enabled } = request.body;
        if (!engine.getDefinition(key)) {
          return reply.status(404).send({ error: 'Unknown achievement key' });
        }
        await settings.setAchievementGloballyEnabled(key, enabled, request.user.id);
        engine.invalidateCache();
        await recordAdminAction(db, {
          adminUserId: request.user.id,
          action: 'achievement.set_enabled_global',
          targetType: 'system',
          after: { key, enabled },
        });
        return reply.status(200).send({ key, enabled });
      },
    );
  };
}

async function ensureRow(
  db: Db,
  gameId: string,
  gamePlayerId: string,
  achievementKey: string,
  target: number,
): Promise<void> {
  await db
    .insert(schema.achievementProgress)
    .values({ gameId, gamePlayerId, achievementKey, progress: 0, target })
    .onConflictDoNothing({
      target: [schema.achievementProgress.gamePlayerId, schema.achievementProgress.achievementKey],
    });
}

async function readRow(
  db: Db,
  gamePlayerId: string,
  achievementKey: string,
): Promise<{ progress: number; target: number; unlockedAt: string | null } | null> {
  const [row] = await db
    .select({
      progress: schema.achievementProgress.progress,
      target: schema.achievementProgress.target,
      unlockedAt: schema.achievementProgress.unlockedAt,
    })
    .from(schema.achievementProgress)
    .where(
      and(
        eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
        eq(schema.achievementProgress.achievementKey, achievementKey),
      ),
    )
    .limit(1);
  return row ?? null;
}
