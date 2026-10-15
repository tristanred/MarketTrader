/**
 * In-process mutex per key: `run(key, fn)` waits for every earlier `run` on the
 * same key to settle before calling `fn`. Holds a check-then-insert together
 * when the path awaits between the two. Only exact within one process, which
 * the single-host deployment (ADR-013, ADR-017) provides.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  /** Number of keys with work queued or running; idle keys are dropped. */
  get size(): number {
    return this.tails.size;
  }

  /** Runs `fn` once the key is free and resolves or rejects with its result. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
