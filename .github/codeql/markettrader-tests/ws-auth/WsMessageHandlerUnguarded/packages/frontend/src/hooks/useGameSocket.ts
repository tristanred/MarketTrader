// GOOD: frontend listeners are out of scope for this server-side invariant.
export function listen(target: any): void {
  target.on('message', (raw: any) => JSON.parse(raw));
}
