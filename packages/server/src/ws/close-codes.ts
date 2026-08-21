/**
 * Close code for every credential rejection: a missing, malformed or expired
 * token, a refused authorization, and the revocations the revalidation sweep
 * finds after upgrade.
 *
 * The client reads a 1008 on a long-open socket as a stale access token and
 * spends a refresh on it, so nothing a fresh token could not fix may be
 * reported with this code — see {@link WS_INVALID_FRAME_CLOSE_CODE}.
 * Mirrored in `packages/frontend/src/lib/wsAuth.ts`; `shared` carries types
 * only, so nothing else makes a one-sided change fail.
 */
export const WS_POLICY_CLOSE_CODE = 1008;

/**
 * Close code for a frame the server refuses: unparseable JSON, an unknown
 * event, or a `subscribe` that fails validation.
 *
 * Deliberately in RFC 6455's private range rather than 1003/1007 — `ws` emits
 * those itself for unsupported data and invalid UTF-8, which would re-create
 * the overloading this code exists to remove.
 */
export const WS_INVALID_FRAME_CLOSE_CODE = 4400;
