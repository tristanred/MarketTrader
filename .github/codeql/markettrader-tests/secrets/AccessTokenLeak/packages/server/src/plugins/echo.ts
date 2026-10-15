// BAD: returns an offered value, so the token is echoed in the handshake response.
export function echoImported(protocols: Set<string>): string | false {
  const [first] = [...protocols];
  return first ?? false;
}
