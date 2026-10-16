import { executeTrade } from '../services/trade';

declare const db: any;
declare const trades: any;

export function tradingRoutes(app: any) {
  app.post('/games/:id/trades', async (request: any, reply: any) => {
    const { symbol, quantity, executedAt } = request.body;
    // BAD: client-supplied execution time handed to the trade service.
    await executeTrade(db, { symbol, quantity, price: 10, executedAt });
    return reply.send({ ok: true });
  });

  app.post('/games/:id/backdate', async (request: any, reply: any) => {
    // BAD: client-supplied execution time written straight into the trades table.
    await db.update(trades).set({ status: 'executed', executedAt: request.query.at });
    return reply.send({ ok: true });
  });

  app.post('/games/:id/trades-ok', async (request: any, reply: any) => {
    const { symbol, quantity } = request.body;
    // GOOD: server clock.
    await executeTrade(db, { symbol, quantity, price: 10, executedAt: new Date().toISOString() });
    // GOOD: request input used for other columns only.
    await db.insert(trades).values({ symbol, quantity, executedAt: new Date().toISOString() });
    return reply.send({ ok: true });
  });

  app.post('/games/:id/spread', async (request: any, reply: any) => {
    // BAD (flagged at the insert in services/trade.ts): the whole body, executedAt included, is spread in.
    await executeTrade(db, { ...request.body, price: 10 });
    return reply.send({ ok: true });
  });

  app.post('/games/:id/schema-ref', async (request: any, reply: any) => {
    const at = request.params?.at;
    if (at) {
      // BAD: optional chaining, aliasing, `schema.trades`, nested in an if.
      await db.update(schema.trades).set({ executedAt: at }).where(1);
    }
    return reply.send({ ok: true });
  });

  app.post('/games/:id/other-table',async (request: any, reply: any) => {
    // GOOD: not the trades table.
    await db.update(otherTable).set({ executedAt: request.body.at });
    return reply.send({ ok: true });
  });
}

declare const otherTable: any;
declare const schema: any;
