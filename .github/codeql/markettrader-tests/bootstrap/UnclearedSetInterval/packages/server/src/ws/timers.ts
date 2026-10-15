declare const app: { addHook(name: string, fn: () => Promise<void>): void };

// OK: cleared in an object-literal method named stop (heartbeat.ts shape).
export function heartbeat() {
  const timer = setInterval(() => {}, 1000);
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}

// OK: cleared in an arrow assigned to a `stop` property (interval-worker.ts shape).
export function worker() {
  const handle = setInterval(() => {}, 1000);
  return {
    stop: async () => {
      clearInterval(handle);
    },
  };
}

// OK: only unref'd, through an optional call (live-route.ts shape).
export function sweepOnly() {
  const sweep = setInterval(() => {}, 1000);
  sweep.unref?.();
}

// OK: cleared in an onClose hook.
export function onClose() {
  const sweep = setInterval(() => {}, 1000);
  app.addHook('onClose', async () => {
    clearInterval(sweep);
  });
}

// OK: this.<field> cleared in the class's stop() (indices-broadcaster.ts shape).
export class Broadcaster {
  private timer: ReturnType<typeof setInterval> | null = null;
  start(): void {
    this.timer = setInterval(() => {}, 5000);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

// BAD: field cleared only in a method that is not a shutdown function.
export class Leaky {
  private timer: ReturnType<typeof setInterval> | null = null;
  start(): void {
    this.timer = setInterval(() => {}, 5000);
  }
  restart(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

// BAD: result discarded.
export function discarded() {
  setInterval(() => {}, 1000);
}

// BAD: stored but never cleared or unref'd.
export function forgotten() {
  const t = setInterval(() => {}, 1000);
  return t !== undefined;
}

// OK: unref() chained directly on the call.
export function chainedUnref() {
  setInterval(() => {}, 1000).unref();
}

// OK: class field initialiser, cleared in close().
export class FieldInit {
  private timer = setInterval(() => {}, 1000);
  close(): void {
    clearInterval(this.timer);
  }
}

// BAD: class field initialiser never cleared.
export class FieldInitLeak {
  private timer = setInterval(() => {}, 1000);
  ping(): boolean {
    return this.timer !== undefined;
  }
}

// OK: cleared in a const-bound stop function.
export function constStop() {
  const t = setInterval(() => {}, 1000);
  const stopTicking = () => clearInterval(t);
  return stopTicking;
}

// OK: type assertion around the call.
export function asserted() {
  const t = setInterval(() => {}, 1000) as unknown as number;
  app.addHook('onClose', async () => {
    clearInterval(t);
  });
}
