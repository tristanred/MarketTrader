import { hash } from '@node-rs/argon2';

declare const users: any;
declare function recordAdminAction(tx: unknown, params: unknown): Promise<void>;

export async function adminUserRoutes(app: any, db: any): Promise<void> {
  app.post('/admin/users/:id/reset-password', {}, async (request: any) => {
    const { newPassword } = request.body;
    const passwordHash = await hash(newPassword);
    await db.transaction(async (tx: any) => {
      await tx.update(users).set({ passwordHash }); // OK: hash
      await recordAdminAction(tx, { action: 'user.reset_password', metadata: {} }); // OK
      await recordAdminAction(tx, { action: 'x', metadata: { newPassword } }); // BAD: audit log
    });
    const headers = new Map<string, string>();
    headers.set('x-debug', newPassword); // OK: not a drizzle write (and not a modelled sink)
  });
}
