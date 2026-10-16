import { describe, it, expect, vi, afterEach } from 'vitest';
import { startIntervalWorker } from '../../src/workers/interval-worker.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('startIntervalWorker', () => {
  it('stop() waits for an in-flight tick to finish before resolving', async () => {
    let releaseTick!: () => void;
    const gate = new Promise<void>((r) => {
      releaseTick = r;
    });
    const events: string[] = [];
    const tick = async () => {
      events.push('tick-start');
      await gate;
      events.push('tick-end');
    };

    const worker = startIntervalWorker('test-inflight', tick, 5);
    // Let the interval fire so a tick is in flight (blocked on the gate).
    await sleep(25);
    expect(events).toEqual(['tick-start']);

    let stopResolved = false;
    const stopPromise = worker.stop().then(() => {
      events.push('stop-resolved');
      stopResolved = true;
    });

    // While the tick is still in flight, stop() must not resolve.
    await sleep(25);
    expect(stopResolved).toBe(false);

    releaseTick();
    await stopPromise;
    // stop() resolved only AFTER the in-flight tick completed.
    expect(events).toEqual(['tick-start', 'tick-end', 'stop-resolved']);
  });

  it('stop() resolves immediately when no tick is in flight', async () => {
    const tick = vi.fn(async () => {});
    const worker = startIntervalWorker('test-idle', tick, 1000);
    await worker.stop();
    expect(tick).not.toHaveBeenCalled();
  });

  it('runs no further ticks after stop()', async () => {
    const tick = vi.fn(async () => {});
    const worker = startIntervalWorker('test-stopped', tick, 10);
    await sleep(25);
    await worker.stop();
    const callsAtStop = tick.mock.calls.length;
    expect(callsAtStop).toBeGreaterThanOrEqual(1);
    await sleep(40);
    expect(tick.mock.calls.length).toBe(callsAtStop);
  });

  it('skips overlapping ticks (re-entrancy guard) and resumes after one completes', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const tick = async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await sleep(30);
      inFlight--;
    };
    const worker = startIntervalWorker('test-reentrancy', tick, 5);
    await sleep(80);
    await worker.stop();
    expect(maxConcurrent).toBe(1);
  });

  it('routes a thrown tick to onError and keeps ticking', async () => {
    const err = new Error('boom');
    let caught: unknown;
    let calls = 0;
    const tick = async () => {
      calls++;
      throw err;
    };
    const worker = startIntervalWorker('test-onerror', tick, 10, (e: unknown) => {
      caught = e;
    });
    await sleep(45);
    await worker.stop();
    expect(caught).toBe(err);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('fires the first tick at start with immediate, and not without it', async () => {
    const eager = vi.fn(async () => {});
    const lazy = vi.fn(async () => {});
    const a = startIntervalWorker('test-immediate', eager, 10_000, undefined, { immediate: true });
    const b = startIntervalWorker('test-not-immediate', lazy, 10_000);
    await sleep(5);
    expect(eager).toHaveBeenCalledTimes(1);
    expect(lazy).not.toHaveBeenCalled();
    await a.stop();
    await b.stop();
  });
});

describe('startIntervalWorker with a dynamic interval', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a changed interval from the next fire onward', async () => {
    vi.useFakeTimers();
    let interval = 1000;
    const tick = vi.fn(async () => {});
    const worker = startIntervalWorker('test-dynamic', tick, () => interval);

    await vi.advanceTimersByTimeAsync(500);
    interval = 100; // the timer armed at t=0 still fires at t=1000
    await vi.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300); // fires at 1100, 1200, 1300
    expect(tick).toHaveBeenCalledTimes(4);
    await worker.stop();
  });

  it('applies a lowered interval to a wait already in progress, within the recheck window', async () => {
    vi.useFakeTimers();
    let interval = 60_000;
    const tick = vi.fn(async () => {});
    const worker = startIntervalWorker('test-lowered', tick, () => interval);

    await vi.advanceTimersByTimeAsync(5_000);
    interval = 1_000;
    await vi.advanceTimersByTimeAsync(5_000); // t=10s: the first recheck wake sees the new interval
    expect(tick).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('does not fire on recheck wakes while the interval is unchanged', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => {});
    const worker = startIntervalWorker('test-recheck-idle', tick, () => 60_000);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('does not spin while a tick overruns the interval', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(() => new Promise<void>((r) => setTimeout(r, 250)));
    const worker = startIntervalWorker('test-overrun', tick, () => 100);

    await vi.advanceTimersByTimeAsync(150); // tick 1 in flight until t=350
    expect(vi.getTimerCount()).toBe(2); // the worker's timer and the tick's own
    // Wakes at 200/300 are skipped by the re-entrancy guard. If a skipped wake
    // left lastFire behind, the timer would re-arm at 0ms and never let fake
    // time advance.
    await vi.advanceTimersByTimeAsync(850);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(10);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(250);
    await worker.stop();
  });

  it('keeps a fixed cadence regardless of tick duration, like setInterval', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(() => new Promise<void>((r) => setTimeout(r, 30)));
    const worker = startIntervalWorker('test-cadence', tick, () => 100);
    await vi.advanceTimersByTimeAsync(350);
    expect(tick).toHaveBeenCalledTimes(3); // 100, 200, 300 — not delayed by the 30ms ticks
    await worker.stop();
  });
});
