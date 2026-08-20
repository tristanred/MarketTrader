import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectController, attachResumeListeners } from '@/lib/reconnect';

describe('ReconnectController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** No jitter, so delays are exactly the exponential curve. */
  function controller(overrides: Partial<ConstructorParameters<typeof ReconnectController>[0]> = {}) {
    return new ReconnectController({
      baseMs: 1_000,
      maxMs: 30_000,
      stableMs: 30_000,
      maxAttempts: 10,
      random: () => 1,
      ...overrides,
    });
  }

  it('grows the delay across successive open-then-immediately-close cycles', () => {
    const c = controller();
    const delays: (number | null)[] = [];

    // The bug: a socket whose handshake succeeds and then drops seconds later.
    for (let i = 0; i < 4; i++) {
      c.markOpen();
      vi.advanceTimersByTime(2_000);
      delays.push(c.scheduleReconnect(() => {}));
      vi.advanceTimersByTime(60_000);
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('resets the delay once a connection survives the stability window', () => {
    const c = controller();
    c.markOpen();
    vi.advanceTimersByTime(2_000);
    expect(c.scheduleReconnect(() => {})).toBe(1_000);
    c.cancel();

    c.markOpen();
    vi.advanceTimersByTime(30_000);

    expect(c.scheduleReconnect(() => {})).toBe(1_000);
  });

  it('caps the delay at maxMs', () => {
    const c = controller();
    let last: number | null = null;
    for (let i = 0; i < 8; i++) {
      last = c.scheduleReconnect(() => {});
      c.cancel();
    }
    expect(last).toBe(30_000);
  });

  it('jitters each delay into the upper-bounded half of the backoff window', () => {
    const low = new ReconnectController({ baseMs: 1_000, random: () => 0 });
    const high = new ReconnectController({ baseMs: 1_000, random: () => 1 });

    expect(low.scheduleReconnect(() => {})).toBe(500);
    expect(high.scheduleReconnect(() => {})).toBe(1_000);
  });

  it('stops scheduling once maxAttempts consecutive attempts are spent', () => {
    const c = controller({ maxAttempts: 3 });
    const connect = vi.fn();

    expect(c.scheduleReconnect(connect)).toBe(1_000);
    vi.advanceTimersByTime(60_000);
    expect(c.scheduleReconnect(connect)).toBe(2_000);
    vi.advanceTimersByTime(60_000);
    expect(c.scheduleReconnect(connect)).toBe(4_000);
    vi.advanceTimersByTime(60_000);

    expect(c.exhausted).toBe(true);
    expect(c.scheduleReconnect(connect)).toBeNull();
    vi.advanceTimersByTime(600_000);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('runs the scheduled connect after the delay elapses', () => {
    const c = controller();
    const connect = vi.fn();
    c.scheduleReconnect(connect);

    vi.advanceTimersByTime(999);
    expect(connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops a pending reconnect and the pending stability reset', () => {
    const c = controller();
    const connect = vi.fn();
    c.markOpen();
    c.scheduleReconnect(connect);
    c.cancel();

    vi.advanceTimersByTime(600_000);
    expect(connect).not.toHaveBeenCalled();
  });

  it('reset() clears the attempt counter so a manual retry starts at the base delay', () => {
    const c = controller({ maxAttempts: 2 });
    c.scheduleReconnect(() => {});
    c.cancel();
    c.scheduleReconnect(() => {});
    c.cancel();
    expect(c.exhausted).toBe(true);

    c.reset();

    expect(c.exhausted).toBe(false);
    expect(c.scheduleReconnect(() => {})).toBe(1_000);
  });
});

describe('attachResumeListeners', () => {
  it('calls back when the browser comes online and when the tab becomes visible', () => {
    const resume = vi.fn();
    const detach = attachResumeListeners(resume);

    window.dispatchEvent(new Event('online'));
    expect(resume).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(resume).toHaveBeenCalledTimes(2);

    detach();
    window.dispatchEvent(new Event('online'));
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('ignores visibilitychange while the tab is still hidden', () => {
    const resume = vi.fn();
    const detach = attachResumeListeners(resume);
    const spy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(resume).not.toHaveBeenCalled();

    spy.mockRestore();
    detach();
  });
});
