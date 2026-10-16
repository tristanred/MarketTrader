import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';

export async function forceFill(db: any, id: string): Promise<void> {
  await db.transaction(async (tx: any) => {
    await tx.update(schema.trades).set({ status: 'executed' }).where(eq(schema.trades.id, id));
  });
}

export async function setSymbolsInTx(tx: any, symbols: string[]): Promise<void> {
  await tx.update(schema.systemSettings).set({ value: symbols.join(',') });
}

export async function readOnly(db: any, id: string) {
  return db.select().from(schema.trades).where(eq(schema.trades.id, id));
}
