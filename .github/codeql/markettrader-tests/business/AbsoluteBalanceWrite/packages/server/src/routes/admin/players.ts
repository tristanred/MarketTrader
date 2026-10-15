import { eq, sql } from 'drizzle-orm';
import { schema } from '../../db/index.js';

declare const db: any;
declare const app: any;
const { gamePlayers, portfolios, users } = schema;

// NEGATIVE (allowlisted): operator sets an absolute balance by design.
app.patch('/admin/players/:playerId/cash', {}, async (request: any) => {
  const { cashBalance } = request.body;
  await db.transaction(async (tx: any) => {
    await tx.update(gamePlayers).set({ cashBalance }).where(eq(gamePlayers.id, request.params.playerId));
  });
});

// NEGATIVE (allowlisted): reset restores the starting balance.
app.post('/admin/games/:id/reset', {}, async (request: any) => {
  await db.transaction(async (tx: any) => {
    await tx.update(gamePlayers).set({ cashBalance: Number(request.body.startingBalance) }).where(eq(gamePlayers.gameId, request.params.id));
  });
});

// POSITIVE: same shorthand shape on a route that is not allowlisted.
app.patch('/admin/players/:playerId/bonus', {}, async (request: any) => {
  const [pl] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, request.params.playerId));
  const cashBalance = Number(pl.cashBalance) + request.body.bonus;
  await db.transaction(async (tx: any) => {
    await tx.update(gamePlayers).set({ cashBalance }).where(eq(gamePlayers.id, request.params.playerId));
  });
});

// POSITIVE: absolute quantity computed from a stale read; schema.portfolios spelling.
app.post('/admin/players/:playerId/holdings', {}, async (request: any) => {
  const [h] = await db.select().from(portfolios).where(eq(portfolios.gamePlayerId, request.params.playerId));
  const newQty = h.quantity + request.body.quantityDelta;
  await db.transaction(async (tx: any) => {
    await tx.update(schema.portfolios).set({ quantity: newQty, avgCostBasis: 1 }).where(eq(portfolios.id, h.id));
  });
});

// NEGATIVE: relative writes.
app.post('/admin/players/:playerId/refund', {}, async (request: any) => {
  await db.transaction(async (tx: any) => {
    await tx.update(gamePlayers).set({ cashBalance: sql`${gamePlayers.cashBalance} + ${request.body.amount}` }).where(eq(gamePlayers.id, request.params.playerId));
    await tx.update(portfolios).set({ quantity: sql`${portfolios.quantity} - ${1}` }).where(eq(portfolios.id, 'x'));
  });
});

// NEGATIVE: other columns / tables / non-Drizzle `.set`.
export async function unrelated(m: Map<string, unknown>) {
  await db.update(gamePlayers).set({ lastSeenUnlockAt: 'now' }).where(eq(gamePlayers.id, 'x'));
  await db.update(users).set({ quantity: 3 }).where(eq(users.id, 'x'));
  m.set('k', { cashBalance: 5 });
}

// NEGATIVE (allowlisted): real reset shape, starting balance read from the game row.
app.post('/admin/games/:id/reset', {}, async (request: any) => {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, request.params.id));
  await db.transaction(async (tx: any) => {
    if (game) {
      await tx.update(gamePlayers).set({ cashBalance: Number(game.startingBalance) }).where(eq(gamePlayers.gameId, request.params.id));
    }
  });
});

// POSITIVE: on the allowlisted cash route, a second write derived from an earlier read is still flagged.
app.patch('/admin/players/:playerId/cash', {}, async (request: any) => {
  const [existing] = await db.select().from(gamePlayers).where(eq(gamePlayers.id, request.params.playerId));
  await db.transaction(async (tx: any) => {
    await tx.update(gamePlayers).set({ cashBalance: Number(existing.cashBalance) + 1 }).where(eq(gamePlayers.id, request.params.playerId));
  });
});

// POSITIVE: payload built in a variable, write nested in an if.
export async function viaPatchObject(id: string, newCash: number, flag: boolean) {
  const patch = { cashBalance: newCash };
  await db.transaction(async (tx: any) => {
    if (flag) {
      await tx.update(gamePlayers).set(patch).where(eq(gamePlayers.id, id));
    }
  });
}

// POSITIVE: absolute write in a service function (no route at all).
export async function serviceAbsolute(id: string, cash: number) {
  await db.transaction(async (tx: any) => {
    await tx.update(gamePlayers).set({ cashBalance: cash - 1 }).where(eq(gamePlayers.id, id));
  });
}
