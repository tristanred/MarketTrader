declare function Fastify(o: unknown): any;
declare function startPricePoller(): { stop(): Promise<void> };
declare function startDiscoverWorker(): { stop(): Promise<void> };
declare function startPortfolioSnapshotWorker(): { stop(): Promise<void> };
declare function startPendingOrdersWorker(): { stop(): Promise<void> };
declare function startWsHeartbeat(): { stop(): void };
declare class Engine {
  start(): void;
  stop(): void;
}
declare class Feed {
  startPolling(): void;
  stop(): void;
  describe(): string;
}
declare class Broadcaster {
  start(): Promise<void>;
  stop(): void;
}

export async function buildApp(disablePoller: boolean) {
  const app = Fastify({});

  // OK: method start paired with stop on the same object.
  const engine = new Engine();
  engine.start();
  app.addHook('onClose', async () => {
    engine.stop();
  });

  // BAD: started, never stopped.
  const broadcaster = new Broadcaster();
  if (!disablePoller) {
    await broadcaster.start();
  }

  if (!disablePoller) {
    // OK: nested in an if, handle stopped in an onClose hook.
    const poller = startPricePoller();
    app.addHook('onClose', async () => {
      await poller.stop();
    });

    // BAD: onClose stops a different variable.
    const discoverWorker = startDiscoverWorker();
    const other = startPortfolioSnapshotWorker();
    app.addHook('onClose', async () => {
      await other.stop();
    });

    // BAD: handle discarded.
    startPendingOrdersWorker();

    // BAD: stopped, but not from an onClose hook.
    const heartbeat = startWsHeartbeat();
    heartbeat.stop();

    // OK: interval cleared on close.
    const tick = setInterval(() => {}, 60_000);
    app.addHook('onClose', async () => {
      clearInterval(tick);
    });

    // BAD: interval never cleared.
    const leaked = setInterval(() => {}, 1000);

    // OK: stopped through an optional call.
    const maybeWorker = startDiscoverWorker();
    app.addHook('onClose', async () => {
      await maybeWorker?.stop();
    });
  }

  // OK: a start* method paired with stop on the same object.
  const feed = new Feed();
  feed.startPolling();
  app.addHook('onClose', async () => {
    feed.stop();
  });

  // BAD: a start* method never stopped.
  const feed2 = new Feed();
  feed2.startPolling();

  // OK: not a background start (no receiver variable to own it).
  new Feed().describe();

  return app;
}
