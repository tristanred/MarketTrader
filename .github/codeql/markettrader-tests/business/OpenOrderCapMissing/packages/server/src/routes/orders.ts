import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';
import { MAX_OPEN_ORDERS_PER_PLAYER } from '../services/orders.js';

const { trades } = schema;

export function orderRoutes(db: any) {
  return async function (app: any): Promise<void> {
    // NEGATIVE: this handler checks the cap.
    app.post('/orders/capped', {}, async (request: any) => {
      await db.transaction(async (tx: any) => {
        const open = await tx.select().from(trades).where(eq(trades.gamePlayerId, request.body.id));
        if (open.length >= MAX_OPEN_ORDERS_PER_PLAYER) throw new Error('too many');
        await tx.insert(trades).values({ gamePlayerId: request.body.id, status: 'working' });
      });
    });

    // POSITIVE: a sibling handler in the same factory does not; the other handler's check must not cover it.
    app.post('/orders/uncapped', {}, async (request: any) => {
      const status = request.body.open ? 'pending' : 'executed';
      await db.insert(trades).values({ gamePlayerId: request.body.id, status });
    });

    // POSITIVE: bulk insert of open rows, status chosen by a conditional.
    app.post('/orders/bulk', {}, async (request: any) => {
      await db.insert(trades).values([
        { gamePlayerId: request.body.id, status: request.body.marketOpen ? 'working' : 'pending' },
      ]);
    });
  };
}
