import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/**
 * Accepts either the top-level Db or a transaction handle returned by
 * `db.transaction(async (tx) => ...)`. We only need .insert(), so a structural
 * subset of Db is sufficient and keeps callers from juggling the exact
 * transaction type (which differs from Db).
 */
type DbOrTx = Pick<Db, 'insert'>;

/** Target categories for admin actions. Free-form `action` strings sit underneath. */
export type AdminAuditTargetType = 'user' | 'game' | 'trade' | 'portfolio' | 'system';

export interface RecordAdminActionParams {
  adminUserId: string;
  action: string;
  targetType: AdminAuditTargetType;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/**
 * Inserts an append-only audit-log row. Always call this inside the same
 * transaction as the mutation it records — pass the `tx` handle from
 * `db.transaction(async (tx) => ...)` as the first arg, not the global `db`.
 * On SQLite (text columns) the JSON blobs are stringified; on Postgres (jsonb
 * columns) Drizzle handles JSON serialisation natively.
 *
 * The function never throws on a malformed `before`/`after`/`metadata` —
 * those are best-effort and shouldn't take down a legitimate mutation.
 */
export async function recordAdminAction(
  tx: DbOrTx,
  params: RecordAdminActionParams,
): Promise<void> {
  await tx.insert(schema.adminAuditLog).values({
    adminUserId: params.adminUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    before: serialiseJson(params.before),
    after: serialiseJson(params.after),
    metadata: serialiseJson(params.metadata),
  });
}

function serialiseJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
