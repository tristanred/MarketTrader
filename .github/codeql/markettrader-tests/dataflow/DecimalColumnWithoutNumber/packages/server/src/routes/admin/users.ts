import { eq } from 'drizzle-orm';
import { games, gamePlayers, trades } from '../../db/schema.pg';

declare function recordAdminAction(tx: unknown, params: Record<string, unknown>): Promise<void>;

export function adminUserRoutes(app: any, db: any) {
  app.get('/admin/users/:id/players', async (request: any, reply: any) => {
    const rows = await db
      .select({ playerId: gamePlayers.id, cashBalance: gamePlayers.cashBalance })
      .from(gamePlayers)
      .where(eq(gamePlayers.userId, request.params.id));
    // BAD: rows carry the raw decimal string.
    return reply.status(200).send({ players: rows });
  });

  app.get('/admin/users/:id/players-ok', async (request: any, reply: any) => {
    const rows = await db
      .select({ playerId: gamePlayers.id, cashBalance: gamePlayers.cashBalance })
      .from(gamePlayers)
      .where(eq(gamePlayers.userId, request.params.id));
    // GOOD: coerced per row.
    return reply.status(200).send({
      players: rows.map((r: any) => ({ playerId: r.playerId, cashBalance: Number(r.cashBalance) })),
    });
  });

  app.get('/admin/users/:id/names', async (request: any, reply: any) => {
    const rows = await db.select({ id: games.id, name: games.name }).from(games);
    // GOOD: no decimal column in the projection.
    return reply.send({ games: rows });
  });

  app.post('/admin/trades/:id/audit', async (request: any, reply: any) => {
    const [trade] = await db.select().from(trades).where(eq(trades.id, request.params.id)).limit(1);
    await db.transaction(async (tx: any) => {
      // BAD: the audit JSON freezes a string on Postgres and a number on SQLite.
      await recordAdminAction(tx, { action: 'x', before: { price: trade.price } });
      // GOOD: coerced.
      await recordAdminAction(tx, { action: 'y', before: { price: Number(trade.price) } });
    });
    return reply.status(204).send();
  });
}
