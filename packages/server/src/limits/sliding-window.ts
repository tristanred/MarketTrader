/** How many hits pass between opportunistic prunes of idle keys. */
const PRUNE_EVERY = 1_000;

interface Entry {
  bucket: number;
  /** Newest first: current half-window, previous one, the one before that. */
  counts: [number, number, number];
}

/**
 * Approximate per-key sliding-window counter with O(1) memory per key.
 *
 * Hits land in half-window buckets. The window total is the current and previous
 * bucket plus the oldest bucket weighted by how much of it still overlaps the
 * window — accurate to within one bucket's skew, and immune to the burst-at-the-
 * boundary doubling a single fixed window allows.
 */
export class SlidingWindowCounter {
  private readonly entries = new Map<string, Entry>();
  private readonly half: number;
  private hitsSincePrune = 0;

  constructor(
    windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.half = windowMs / 2;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Records one hit for `key` and returns the window total including it. */
  hit(key: string): number {
    const entry = this.roll(key) ?? this.create(key);
    entry.counts[0] += 1;
    if (++this.hitsSincePrune >= PRUNE_EVERY) this.prune();
    return this.total(entry);
  }

  /** The window total for `key` without recording a hit. */
  peek(key: string): number {
    const entry = this.roll(key);
    return entry ? this.total(entry) : 0;
  }

  /** Drops keys whose newest hit or peek is more than a full window old. */
  prune(): void {
    this.hitsSincePrune = 0;
    const bucket = this.bucketNow();
    for (const [key, entry] of this.entries) {
      if (bucket - entry.bucket > 2) this.entries.delete(key);
    }
  }

  private bucketNow(): number {
    return Math.floor(this.now() / this.half);
  }

  private create(key: string): Entry {
    const entry: Entry = { bucket: this.bucketNow(), counts: [0, 0, 0] };
    this.entries.set(key, entry);
    return entry;
  }

  private roll(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const bucket = this.bucketNow();
    const shift = bucket - entry.bucket;
    if (shift > 0) {
      const [c0, c1] = entry.counts;
      entry.counts = shift === 1 ? [0, c0, c1] : shift === 2 ? [0, 0, c0] : [0, 0, 0];
      entry.bucket = bucket;
    }
    return entry;
  }

  private total(entry: Entry): number {
    const into = (this.now() % this.half) / this.half;
    return entry.counts[0] + entry.counts[1] + entry.counts[2] * (1 - into);
  }
}
