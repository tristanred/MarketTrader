declare function signAccessToken(app: unknown, p: unknown): string;

// OK: outside application source; must never be flagged.
export function t(): void {
  const tok = signAccessToken({}, {});
  console.log(tok);
}
