// postgres-js exposes the SQLSTATE, libsql the SQLite extended result code —
// both on `code`, both on the driver error itself.
const UNIQUE_VIOLATION_CODES = new Set([
  '23505',
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
]);

/**
 * True when `err` — or any error in its `cause` chain — is a unique-constraint
 * violation, judged by the driver's own error code. drizzle-orm ≥0.44 wraps
 * driver errors in a `DrizzleQueryError`, so the code lives on `.cause`; walk
 * the chain (bounded against cyclic causes) so callers can map duplicates to
 * HTTP 409. The rendered message is deliberately not consulted: the wrapper
 * interpolates the bound parameters into its own message, which would let a
 * caller-supplied value decide the classification.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur instanceof Error; depth += 1) {
    const { code } = cur as { code?: unknown };
    if (typeof code === 'string' && UNIQUE_VIOLATION_CODES.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
