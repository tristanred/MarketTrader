import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { Watchlist } from '@markettrader/shared';

const nameSchema = z
  .string()
  .min(1)
  .max(60)
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, { message: 'name must not be empty' });

const symbolSchema = z
  .string()
  .min(1)
  .max(10)
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z][A-Z0-9.\-]*$/.test(s), {
    message: 'invalid symbol',
  });

const createBodySchema = z.object({ name: nameSchema });
const renameBodySchema = z.object({ name: nameSchema });
const addItemBodySchema = z.object({ symbol: symbolSchema });
const watchlistIdParamsSchema = z.object({ id: z.string() });
const watchlistItemParamsSchema = z.object({ id: z.string(), symbol: z.string() });

/**
 * Loads a single watchlist owned by `userId` plus its symbols in addedAt order.
 * Returns `null` when the watchlist does not exist or is owned by someone else.
 */
async function loadWatchlistForUser(
  db: Db,
  watchlistId: string,
  userId: string,
): Promise<Watchlist | null> {
  const { watchlists, watchlistItems } = schema;
  const [row] = await db
    .select({ id: watchlists.id, name: watchlists.name, createdAt: watchlists.createdAt })
    .from(watchlists)
    .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)));
  if (!row) return null;
  const items = await db
    .select({ symbol: watchlistItems.symbol })
    .from(watchlistItems)
    .where(eq(watchlistItems.watchlistId, watchlistId))
    .orderBy(asc(watchlistItems.addedAt));
  return { id: row.id, name: row.name, createdAt: row.createdAt, symbols: items.map((i) => i.symbol) };
}

/**
 * Registers user watchlist routes (all require authentication):
 * - `GET    /watchlists`              — list the caller's watchlists with their symbols.
 * - `POST   /watchlists`              — create a new watchlist for the caller.
 * - `PATCH  /watchlists/:id`          — rename a watchlist the caller owns.
 * - `DELETE /watchlists/:id`          — delete a watchlist the caller owns (cascades items).
 * - `POST   /watchlists/:id/items`    — add a symbol (idempotent).
 * - `DELETE /watchlists/:id/items/:symbol` — remove a symbol (idempotent).
 *
 * Watchlists are user-scoped, not game-scoped. Any `:id` that does not belong
 * to the caller returns 404 (no leaking existence). Duplicate names/symbols
 * are treated as idempotent — the existing record is returned rather than 409.
 */
export function watchlistRoutes(db: Db) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    const { watchlists, watchlistItems } = schema;

    app.get('/watchlists', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Watchlists'],
        summary: "List the caller's watchlists with their symbols.",
        security: [{ bearerAuth: [] }],
      },
    }, async (request, reply) => {
      const userId = request.user.id;
      const lists = await db
        .select({ id: watchlists.id, name: watchlists.name, createdAt: watchlists.createdAt })
        .from(watchlists)
        .where(eq(watchlists.userId, userId))
        .orderBy(asc(watchlists.createdAt));

      if (lists.length === 0) return reply.status(200).send([]);

      const items = await db
        .select({
          watchlistId: watchlistItems.watchlistId,
          symbol: watchlistItems.symbol,
          addedAt: watchlistItems.addedAt,
        })
        .from(watchlistItems)
        .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
        .where(eq(watchlists.userId, userId))
        .orderBy(asc(watchlistItems.addedAt));

      const symbolsByList = new Map<string, string[]>();
      for (const item of items) {
        const list = symbolsByList.get(item.watchlistId) ?? [];
        list.push(item.symbol);
        symbolsByList.set(item.watchlistId, list);
      }

      const result: Watchlist[] = lists.map((l) => ({
        id: l.id,
        name: l.name,
        createdAt: l.createdAt,
        symbols: symbolsByList.get(l.id) ?? [],
      }));
      return reply.status(200).send(result);
    });

    app.post('/watchlists', {
      onRequest: rawApp.authenticate,
      schema: {
        tags: ['Watchlists'],
        summary: 'Create a new watchlist (idempotent on name).',
        security: [{ bearerAuth: [] }],
        body: createBodySchema,
      },
    }, async (request, reply) => {
      const userId = request.user.id;
      const { name } = request.body;

      // Idempotent: if a list with this name already exists, return it.
      const [existing] = await db
        .select({ id: watchlists.id })
        .from(watchlists)
        .where(and(eq(watchlists.userId, userId), eq(watchlists.name, name)));
      if (existing) {
        const loaded = await loadWatchlistForUser(db, existing.id, userId);
        return reply.status(200).send(loaded);
      }

      const [row] = await db.insert(watchlists).values({ userId, name }).returning();
      if (!row) return reply.status(500).send({ error: 'Failed to create watchlist' });
      const loaded = await loadWatchlistForUser(db, row.id, userId);
      return reply.status(201).send(loaded);
    });

    app.patch(
      '/watchlists/:id',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Watchlists'],
          summary: 'Rename a watchlist.',
          security: [{ bearerAuth: [] }],
          params: watchlistIdParamsSchema,
          body: renameBodySchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const watchlistId = request.params.id;

        const existing = await loadWatchlistForUser(db, watchlistId, userId);
        if (!existing) return reply.status(404).send({ error: 'Watchlist not found' });

        try {
          await db
            .update(watchlists)
            .set({ name: request.body.name })
            .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)));
        } catch (err) {
          // Likely a unique-constraint violation on (userId, name)
          return reply.status(409).send({ error: 'A watchlist with that name already exists' });
        }

        const updated = await loadWatchlistForUser(db, watchlistId, userId);
        return reply.status(200).send(updated);
      },
    );

    app.delete(
      '/watchlists/:id',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Watchlists'],
          summary: 'Delete a watchlist (cascades items).',
          security: [{ bearerAuth: [] }],
          params: watchlistIdParamsSchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const watchlistId = request.params.id;

        const existing = await loadWatchlistForUser(db, watchlistId, userId);
        if (!existing) return reply.status(404).send({ error: 'Watchlist not found' });

        await db
          .delete(watchlists)
          .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)));
        return reply.status(204).send();
      },
    );

    app.post(
      '/watchlists/:id/items',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Watchlists'],
          summary: 'Add a symbol to a watchlist (idempotent).',
          security: [{ bearerAuth: [] }],
          params: watchlistIdParamsSchema,
          body: addItemBodySchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const watchlistId = request.params.id;
        const { symbol } = request.body;

        const existing = await loadWatchlistForUser(db, watchlistId, userId);
        if (!existing) return reply.status(404).send({ error: 'Watchlist not found' });

        if (!existing.symbols.includes(symbol)) {
          try {
            await db.insert(watchlistItems).values({ watchlistId, symbol });
          } catch {
            // Concurrent insert race — unique constraint kicked in; treat as idempotent.
          }
        }
        const updated = await loadWatchlistForUser(db, watchlistId, userId);
        return reply.status(200).send(updated);
      },
    );

    app.delete(
      '/watchlists/:id/items/:symbol',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Watchlists'],
          summary: 'Remove a symbol from a watchlist (idempotent).',
          security: [{ bearerAuth: [] }],
          params: watchlistItemParamsSchema,
        },
      },
      async (request, reply) => {
        const userId = request.user.id;
        const watchlistId = request.params.id;
        const symbol = request.params.symbol.toUpperCase();

        const existing = await loadWatchlistForUser(db, watchlistId, userId);
        if (!existing) return reply.status(404).send({ error: 'Watchlist not found' });

        await db
          .delete(watchlistItems)
          .where(and(eq(watchlistItems.watchlistId, watchlistId), eq(watchlistItems.symbol, symbol)));

        const updated = await loadWatchlistForUser(db, watchlistId, userId);
        return reply.status(200).send(updated);
      },
    );
  };
}
