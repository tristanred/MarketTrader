/** A background loop with a graceful, awaitable stop. */
export interface IntervalWorker {
  /**
   * Clears the interval and resolves once any in-flight tick has finished, so
   * callers (e.g. the shutdown path) can guarantee no tick is still writing the
   * database before they close the connection.
   */
  stop: () => Promise<void>;
}

/**
 * Runs `tick` every `intervalMs`, never overlapping: if a tick is still running
 * when the interval fires, that fire is skipped (re-entrancy guard). A rejected
 * tick is routed to `onError` and does not stop the loop.
 *
 * {@link IntervalWorker.stop} awaits the in-flight tick — this is the property
 * the synchronous `clearInterval` pattern lacked, and why a tick could race
 * `closeDb()` during shutdown.
 */
export function startIntervalWorker(
  tick: () => Promise<void>,
  intervalMs: number,
  onError?: (err: unknown) => void,
): IntervalWorker {
  let running = false;
  let stopped = false;
  // The currently-running tick's settled promise (resolves even if the tick
  // throws), or null when idle. stop() awaits this to drain a live tick.
  let inflight: Promise<void> | null = null;

  const handle = setInterval(() => {
    if (running || stopped) return;
    running = true;
    inflight = tick()
      .catch((err) => {
        onError?.(err);
      })
      .finally(() => {
        running = false;
        inflight = null;
      });
  }, intervalMs);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(handle);
      await inflight;
    },
  };
}
