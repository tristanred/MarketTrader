declare const trades: any;

export async function executeTrade(
  db: any,
  params: { symbol: string; quantity: number; price: number; executedAt?: string },
) {
  const executedAt = params.executedAt ?? new Date().toISOString();
  // Flagged only through the BAD caller in routes/trading.ts.
  await db.insert(trades).values({ symbol: params.symbol, quantity: params.quantity, executedAt });
}
