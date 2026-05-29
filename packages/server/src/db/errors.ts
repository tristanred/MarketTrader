/**
 * True when `err` — or any error in its `cause` chain — is a unique-constraint
 * violation. drizzle-orm ≥0.44 wraps driver errors in a `DrizzleQueryError`
 * whose own message is a generic "Failed query: …", so the SQLite
 * ("UNIQUE constraint failed") / Postgres ("unique constraint", SQLSTATE 23505)
 * signal lives on `.cause` rather than the top-level message. Walk the chain
 * (bounded against cyclic causes) so callers can map duplicates to HTTP 409.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur instanceof Error; depth += 1) {
    if ((cur as { code?: unknown }).code === '23505') return true;
    if (cur.message.toLowerCase().includes('unique constraint')) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
