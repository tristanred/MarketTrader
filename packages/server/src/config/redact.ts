// Userinfo runs to the last `@` before any query or fragment, not just before the
// first `/`: an unencoded `/` or `@` in a password would otherwise leak its tail.
// The cost is over-masking a URL whose path contains `@`, which is display-only.
const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^?#]*@/i;
// Any parameter whose name ends in a credential word: libsql's `authToken`,
// libpq's `password`/`sslpassword`, `api_key`, `access_token`, …
const CREDENTIAL_PARAM = /([?&][^=&#]*(?:token|password|passwd|pwd|secret|key)=)[^&#]*/gi;

/**
 * Masks credentials in a URL-shaped config value for display: the userinfo part
 * (`user:pass@`) and credential-looking query parameters such as libsql's
 * `authToken`. Anything that is not a URL (a SQLite path) is returned unchanged.
 */
export function redactConfigUrl(raw: string): string {
  return raw.replace(USERINFO, '$1***@').replace(CREDENTIAL_PARAM, '$1***');
}
