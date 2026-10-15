import { and, eq, inArray, or } from 'drizzle-orm';
import { schema } from '../db/index.js';

const { portfolios, trades } = schema;

// POSITIVE (one result, at the reservation +=; the holdings += is not tied to an open-order query).
export async function valueOf(db: any, id: string, price: number) {
  let total = 0;
  const holdings = await db.select().from(portfolios).where(eq(portfolios.gamePlayerId, id));
  for (const h of holdings) {
    total += h.quantity * price;
  }
  const open = await db
    .select()
    .from(trades)
    .where(and(eq(trades.gamePlayerId, id), inArray(trades.status, ['pending', 'working'])));
  for (const row of open) {
    if (row.direction === 'buy') total += Number(row.reservedCash ?? 0);
    else total += row.quantity * price;
  }
  return total;
}

// POSITIVE: or(eq(...)) spelling of the open-status filter, schema.trades spelling.
export async function valueOf2(db: any, price: number) {
  let total = 0;
  const rows = await db.select().from(schema.trades).where(or(eq(schema.trades.status, 'working'), eq(schema.trades.status, 'pending')));
  for (const r of rows) {
    if (r.direction === 'sell') total += r.quantity * price;
  }
  return total;
}

// NEGATIVE: skips bracket children.
export async function valueOfCorrect(db: any, id: string, price: number) {
  let total = 0;
  const open = await db.select().from(trades).where(and(eq(trades.gamePlayerId, id), inArray(trades.status, ['pending', 'working'])));
  for (const row of open) {
    if (row.parentTradeId != null && row.bracketRole !== 'entry') continue;
    if (row.direction === 'sell') total += row.quantity * price;
  }
  return total;
}

// POSITIVE: destructured loop variable; parentTradeId only appears in the projection.
export async function valueOfDestructured(db: any, price: number) {
  let total = 0;
  const rows = await db
    .select({ quantity: trades.quantity, direction: trades.direction, parentTradeId: trades.parentTradeId })
    .from(trades)
    .where(inArray(trades.status, ['pending', 'working']));
  for (const { quantity, direction } of rows) {
    if (direction === 'sell') total += quantity * price;
  }
  return total;
}

// NEGATIVE: destructured bracket columns tested in the loop.
export async function valueOfDestructuredCorrect(db: any, price: number) {
  let total = 0;
  const rows = await db.select().from(trades).where(inArray(trades.status, ['pending', 'working']));
  for (const { quantity, direction, parentTradeId, bracketRole } of rows) {
    if (parentTradeId != null && bracketRole !== 'entry') continue;
    if (direction === 'sell') total += quantity * price;
  }
  return total;
}

// NEGATIVE: executed history, not open orders.
export async function realized(db: any, price: number) {
  let total = 0;
  const done = await db.select().from(trades).where(eq(trades.status, 'executed'));
  for (const row of done) total += row.quantity * price;
  return total;
}
