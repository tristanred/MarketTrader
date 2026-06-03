import { describe, it, expect, vi } from 'vitest';
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

    const worker = startIntervalWorker(tick, 5);
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
    const worker = startIntervalWorker(tick, 1000);
    await worker.stop();
    expect(tick).not.toHaveBeenCalled();
  });

  it('runs no further ticks after stop()', async () => {
    const tick = vi.fn(async () => {});
    const worker = startIntervalWorker(tick, 10);
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
    const worker = startIntervalWorker(tick, 5);
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
    const worker = startIntervalWorker(tick, 10, (e) => {
      caught = e;
    });
    await sleep(45);
    await worker.stop();
    expect(caught).toBe(err);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
