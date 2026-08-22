/**
 * Scheme marker offered as the first `Sec-WebSocket-Protocol` value on every
 * authenticated socket; the access token rides as the second.
 *
 * A URL query parameter would be logged verbatim by the reverse proxy and the
 * API process, so the credential travels in the upgrade header instead. Keep
 * this in step with `WS_AUTH_SUBPROTOCOL` in
 * `packages/server/src/ws/subprotocol.ts` — the server closes any socket whose
 * offer it does not recognise. It cannot live in `@markettrader/shared`, which
 * carries types only.
 */
export const WS_AUTH_SUBPROTOCOL = 'markettrader.auth.v1';

/** The subprotocol offer for a socket authenticated by `token`. */
export function wsAuthProtocols(token: string): [string, string] {
  return [WS_AUTH_SUBPROTOCOL, token];
}

/**
 * WebSocket close code the server uses for every credential rejection, and
 * only those. Keep in step with `WS_POLICY_CLOSE_CODE` in
 * `packages/server/src/ws/close-codes.ts`.
 */
export const WS_POLICY_CLOSE_CODE = 1008;

/**
 * Close code the server uses for a frame it refuses to parse.
 *
 * Distinct from {@link WS_POLICY_CLOSE_CODE} so a rejected frame on a
 * long-open socket is not mistaken for an expired token: that misreading costs
 * a wasted refresh and a reconnect that re-sends the same bad frame. A close
 * carrying this code takes the ordinary backoff path — the credential is fine,
 * so there is nothing to refresh. Pinned against the server in
 * `tests/lib/wsAuth.test.ts`.
 */
export const WS_INVALID_FRAME_CLOSE_CODE = 4400;

/**
 * How long a socket must have been open for a 1008 to read as an expired
 * token rather than an authorization refusal.
 *
 * The server revalidates admitted sockets and closes them when the access
 * token expires, which is minutes after connecting; a refusal — not a game
 * member, account disabled — arrives within milliseconds of the handshake.
 * The two need different handling: a refresh fixes the first and would spin
 * forever on the second.
 */
export const WS_CREDENTIAL_STALE_AFTER_MS = 5_000;

/**
 * True when a close means "this socket's token went stale", which calls for a
 * token refresh rather than a backoff reconnect.
 *
 * @param code - The close frame's status code, if the event carried one.
 * @param openedAt - `Date.now()` at open, or 0 if the socket never opened.
 */
export function isStaleCredentialClose(code: number | undefined, openedAt: number): boolean {
  if (code !== WS_POLICY_CLOSE_CODE || openedAt === 0) return false;
  return Date.now() - openedAt >= WS_CREDENTIAL_STALE_AFTER_MS;
}
