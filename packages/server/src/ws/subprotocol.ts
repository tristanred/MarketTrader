/**
 * Marker offered as the first `Sec-WebSocket-Protocol` value on every
 * authenticated WebSocket upgrade. The access token rides as the second value.
 *
 * A URL query parameter would be written verbatim to the reverse-proxy access
 * log and the process journal; a request header is not. The marker exists so
 * the server has something safe to echo back — RFC 6455 requires the response
 * to name a subprotocol the client offered, and echoing the token itself would
 * put the credential straight back into a logged response line.
 */
export const WS_AUTH_SUBPROTOCOL = 'markettrader.auth.v1';

/**
 * Picks the access token out of a `Sec-WebSocket-Protocol` offer of exactly
 * `[{@link WS_AUTH_SUBPROTOCOL}, <token>]`, in either order.
 *
 * Returns `undefined` for an absent header, a missing marker, or any other
 * value count — callers treat that as "no credential presented".
 */
export function extractSubprotocolToken(
  header: string | string[] | undefined,
): string | undefined {
  if (header === undefined) return undefined;
  const values = (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length !== 2) return undefined;
  const markerIndex = values.indexOf(WS_AUTH_SUBPROTOCOL);
  if (markerIndex === -1) return undefined;
  return values[1 - markerIndex];
}

/**
 * `ws`'s `handleProtocols` hook: accept the connection by echoing the marker,
 * never the token. Returning `false` sends no `Sec-WebSocket-Protocol` header,
 * which fails the handshake client-side for any offer we don't understand.
 */
export function handleWsProtocols(protocols: Set<string>): string | false {
  return protocols.has(WS_AUTH_SUBPROTOCOL) ? WS_AUTH_SUBPROTOCOL : false;
}
