export class FailedLoginTracker {
  private readonly entries = new Map<string, number>();

  retryAfterMs(username: string): number | null {
    // Internal key operations are reached via the calls into this class;
    // they must not be reported a second time.
    return this.entries.get(username) ?? null;
  }

  recordFailure(username: string): boolean {
    const n = (this.entries.get(username) ?? 0) + 1;
    this.entries.set(username, n);
    return n > 5;
  }

  reset(username: string): void {
    this.entries.delete(username);
  }
}
