import { eq } from 'drizzle-orm';
import { games, gamePlayers, trades } from '../db/schema.pg';

export function gameRoutes(app: any, db: any) {
  app.get('/games/:id', async (request: any, reply: any) => {
    const [game] = await db.select().from(games).where(eq(games.id, request.params.id)).limit(1);
    // GOOD: the spread copies the raw decimal, but it is overridden with Number().
    return reply.status(200).send({ ...game, startingBalance: Number(game.startingBalance) });
  });

  app.get('/games/:id/raw', async (request: any, reply: any) => {
    const [game] = await db.select().from(games).where(eq(games.id, request.params.id)).limit(1);
    // BAD: spread without override.
    return reply.status(200).send({ ...game, extra: 1 });
  });

  app.get('/games/:id/mapped', async (request: any, reply: any) => {
    const rows = await db.select().from(games);
    // BAD: per-row spread without override.
    return reply.send({ games: rows.map((r: any) => ({ ...r, playerCount: 0 })) });
  });

  app.get('/games/:id/returned', async (request: any) => {
    const player = await db.query.gamePlayers.findFirst({ where: eq(gamePlayers.id, request.params.id) });
    // BAD: a value returned from a route handler is the response body.
    return { cash: player?.cashBalance };
  });

  app.get('/games/:id/destructured', async (request: any, reply: any) => {
    const [player] = await db.select().from(gamePlayers).limit(1);
    const { cashBalance } = player;
    // BAD: destructured decimal in arithmetic.
    const doubled = cashBalance * 2;
    const alias = player;
    let total = 0;
    if (alias) {
      // BAD: aliased, nested in an if, compound assignment.
      total += alias.cashBalance;
    }
    // GOOD: optional-chained read wrapped in Number().
    const ok = Number(player?.cashBalance ?? 0) * 2;
    return reply.send({ doubled: Number(doubled), total: Number(total), ok });
  });

  app.get('/games/:id/loop', async (request: any, reply: any) => {
    const rows = await db.select({ id: gamePlayers.id, cash: gamePlayers.cashBalance }).from(gamePlayers);
    for (const r of rows) {
      // BAD: a whole row (renamed decimal key) in an event payload.
      app.bus.emit({ type: 'player', player: r });
      // GOOD: the renamed key is overridden after the spread.
      app.bus.emit({ type: 'player', player: { ...r, cash: Number(r.cash) } });
    }
    // BAD: indexed row in the response.
    return reply.send({ first: rows[0] });
  });

  app.get('/games/:id/tofixed',async (request: any, reply: any) => {
    const [t] = await db.select({ p: trades.price }).from(trades).limit(1);
    // BAD: toFixed on a string throws.
    const label = t.p.toFixed(2);
    // GOOD: coerced first.
    const labelOk = Number(t.p).toFixed(2);
    return reply.send({ label, labelOk });
  });
}
