import { eq, or } from 'drizzle-orm';
import { schema } from '../db/index.js';

declare const db: any;
const { trades } = schema;

export const MAX_OPEN_ORDERS_PER_PLAYER = 50;

// POSITIVE: queues a pending row with no cap.
export async function reserveUncapped(gamePlayerId: string) {
  return db.transaction(async (tx: any) => {
    await tx.insert(trades).values({ gamePlayerId, status: 'pending' });
  });
}

// POSITIVE: schema.trades spelling, working row.
export async function placeUncapped(gamePlayerId: string) {
  await db.insert(schema.trades).values({ gamePlayerId, status: 'working' });
}

// NEGATIVE: cap read in the same function.
export async function placeCapped(gamePlayerId: string) {
  return db.transaction(async (tx: any) => {
    const open = await tx.select().from(trades).where(or(eq(trades.status, 'working'), eq(trades.status, 'pending')));
    if (open.length + 1 > MAX_OPEN_ORDERS_PER_PLAYER) throw new Error('too many');
    await tx.insert(trades).values({ gamePlayerId, status: 'working' });
  });
}

async function assertUnderCap(tx: any, gamePlayerId: string) {
  const open = await tx.select().from(trades).where(eq(trades.gamePlayerId, gamePlayerId));
  if (open.length >= MAX_OPEN_ORDERS_PER_PLAYER) throw new Error('too many');
}

// NEGATIVE: cap enforced through a helper.
export async function placeViaHelper(gamePlayerId: string) {
  return db.transaction(async (tx: any) => {
    await assertUnderCap(tx, gamePlayerId);
    await tx.insert(trades).values({ gamePlayerId, status: 'pending' });
  });
}

async function insertRow(tx: any, gamePlayerId: string) {
  await tx.insert(trades).values({ gamePlayerId, status: 'working' });
}

// NEGATIVE: the inserting helper's same-file caller enforces the cap.
export async function placeThroughInsertHelper(gamePlayerId: string) {
  return db.transaction(async (tx: any) => {
    await assertUnderCap(tx, gamePlayerId);
    await insertRow(tx, gamePlayerId);
  });
}

// NEGATIVE: executed rows are not open orders.
export async function recordFill(gamePlayerId: string) {
  await db.insert(trades).values({ gamePlayerId, status: 'executed' });
}
