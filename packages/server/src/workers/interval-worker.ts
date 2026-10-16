import { SpanStatusCode } from '@opentelemetry/api';
import { meters, tracer } from '../observability/telemetry.js';

/**
 * Wraps one tick in a span plus duration/outcome metrics. Rethrows so the
 * caller's existing error routing is untouched — this only observes.
 */
async function instrumentedTick(name: string, tick: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  return tracer.startActiveSpan(`worker.tick ${name}`, async (span) => {
    try {
      await tick();
      meters.workerTicks.add(1, { worker: name, outcome: 'ok' });
    } catch (err) {
      meters.workerTicks.add(1, { worker: name, outcome: 'error' });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      meters.workerDuration.record(Date.now() - startedAt, { worker: name });
      span.end();
    }
  });
}

/** Longest single wait, so a lowered interval is noticed without a restart. */
export const RECHECK_MS = 10_000;

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
 * `intervalMs` may be a getter; it is re-read at least every {@link RECHECK_MS},
 * so a lowered interval takes effect within that window, not after the old wait.
 *
 * `name` identifies the loop in telemetry — every tick gets a `worker.tick`
 * span and a duration/outcome metric, which is why background work is
 * observable without each worker instrumenting itself.
 *
 * With `options.immediate`, the first tick fires at start instead of after one
 * interval — for workers whose output users would otherwise wait a full
 * interval for after a restart.
 *
 * {@link IntervalWorker.stop} awaits the in-flight tick — this is the property
 * the synchronous `clearInterval` pattern lacked, and why a tick could race
 * `closeDb()` during shutdown.
 */
export function startIntervalWorker(
  name: string,
  tick: () => Promise<void>,
  intervalMs: number | (() => number),
  onError?: (err: unknown) => void,
  options: { immediate?: boolean } = {},
): IntervalWorker {
  const nextDelay = typeof intervalMs === 'function' ? intervalMs : () => intervalMs;
  let running = false;
  let stopped = false;
  // The currently-running tick's settled promise (resolves even if the tick
  // throws), or null when idle. stop() awaits this to drain a live tick.
  let inflight: Promise<void> | null = null;
  let handle: ReturnType<typeof setTimeout> | undefined;

  const fire = () => {
    if (running || stopped) return;
    running = true;
    inflight = instrumentedTick(name, tick)
      .catch((err) => {
        onError?.(err);
      })
      .finally(() => {
        running = false;
        inflight = null;
      });
  };
  // A self-re-arming timeout instead of setInterval, so a changed interval
  // applies without restarting the worker. Each wait is capped at RECHECK_MS
  // and the interval re-read on every wake, so lowering a long interval takes
  // effect within RECHECK_MS instead of after the old wait runs out. lastFire
  // advances on every due wake, even one fire() skips because a tick is still
  // running — otherwise an overrunning tick would re-arm at 0ms and spin.
  let lastFire = Date.now();
  const schedule = () => {
    const wait = Math.max(0, Math.min(lastFire + nextDelay() - Date.now(), RECHECK_MS));
    handle = setTimeout(() => {
      if (Date.now() - lastFire >= nextDelay()) {
        lastFire = Date.now();
        fire();
      }
      if (!stopped) schedule();
    }, wait);
  };
  schedule();
  if (options.immediate) fire();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(handle);
      await inflight;
    },
  };
}
