import { schema } from '../db/index.js';

export async function recordAdminAction(handle: any, entry: Record<string, unknown>): Promise<void> {
  await handle.insert(schema.adminAuditLog).values(entry);
}
