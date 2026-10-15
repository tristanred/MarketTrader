import { eq } from 'drizzle-orm';
import { schema } from '../../db/index.js';
import { recordAdminAction } from '../../services/admin-audit.js';
import { forceFill, readOnly, setSymbolsInTx } from '../../services/orders.js';

async function auditVia(handle: any, action: string) {
  await recordAdminAction(handle, { action });
}

// NEGATIVE: a helper only ever fed the tx.
async function auditInTx(handle: any, action: string) {
  await recordAdminAction(handle, { action });
}

export async function onlyTx(db: any, id: string) {
  await db.transaction(async (tx: any) => {
    await tx.update(schema.games).set({ name: id }).where(eq(schema.games.id, id));
    await auditInTx(tx, 'only-tx');
  });
}

export function adminThingsRoutes(db: any) {
  return async function (app: any): Promise<void> {
    const { games, trades } = schema;

    // POSITIVE: audit written on the base connection.
    app.post('/admin/things/:id/unlock', {}, async (request: any) => {
      await db.update(games).set({ name: 'x' }).where(eq(games.id, request.params.id));
      await recordAdminAction(db, { action: 'unlock' });
    });

    // POSITIVE: mutation in a service, audit in its own transaction afterwards.
    app.post('/admin/things/:id/fill', {}, async (request: any) => {
      const before = await readOnly(db, request.params.id);
      await forceFill(db, request.params.id);
      await db.transaction(async (tx: any) => {
        await recordAdminAction(tx, { action: 'fill', before });
      });
    });

    // POSITIVE: mutation in one transaction, audit in a second one.
    app.delete('/admin/things/:id', {}, async (request: any) => {
      await db.transaction(async (tx: any) => {
        await tx.update(trades).set({ status: 'cancelled' }).where(eq(trades.id, request.params.id));
      });
      await db.transaction(async (tx: any) => {
        await recordAdminAction(tx, { action: 'cancel' });
      });
    });

    // NEGATIVE: mutation and audit share the transaction.
    app.patch('/admin/things/:id', {}, async (request: any) => {
      await db.transaction(async (tx: any) => {
        await tx.update(games).set({ name: request.body.name }).where(eq(games.id, request.params.id));
        await recordAdminAction(tx, { action: 'rename' });
      });
    });

    // NEGATIVE: the transaction mutates through a helper that receives tx.
    app.put('/admin/things/symbols', {}, async (request: any) => {
      await db.transaction(async (tx: any) => {
        await setSymbolsInTx(tx, request.body.symbols);
        await recordAdminAction(tx, { action: 'symbols' });
      });
    });

    // POSITIVE (flagged at the helper's audit call): one caller passes tx, another passes db.
    app.post('/admin/things/:id/archive', {}, async (request: any) => {
      await db.transaction(async (tx: any) => {
        await tx.update(games).set({ name: 'archived' }).where(eq(games.id, request.params.id));
        await auditVia(tx, 'archive');
      });
    });
    app.post('/admin/things/:id/touch', {}, async (request: any) => {
      await db.update(games).set({ name: 'touched' }).where(eq(games.id, request.params.id));
      await auditVia(db, 'touch');
    });

    // NEGATIVE: audit-only transaction with no mutation anywhere in the handler.
    app.post('/admin/things/:id/inspect', {}, async (request: any) => {
      const rows = await readOnly(db, request.params.id);
      await db.transaction(async (tx: any) => {
        await recordAdminAction(tx, { action: 'inspect', count: rows.length });
      });
    });
  };
}
