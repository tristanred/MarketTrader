// GOOD: frontend event type, not a server credential decision.
export function isRefreshEvent(event: { type: string }): boolean {
  return event.type === 'refresh';
}
