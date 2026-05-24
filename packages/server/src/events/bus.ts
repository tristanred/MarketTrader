import type { FastifyBaseLogger } from 'fastify';
import type { DomainEvent, DomainEventType, DomainEventOf } from './types.js';

export type DomainEventHandler<T extends DomainEventType> = (
  event: DomainEventOf<T>,
) => void | Promise<void>;

/**
 * Lightweight in-process event bus for {@link DomainEvent}s. Synchronous
 * `emit` returns immediately; handlers are run concurrently via
 * `Promise.allSettled` so a slow or throwing handler does not block the
 * originating request. Rejections are logged but never propagated.
 *
 * Not a substitute for a durable queue — events are lost on process exit.
 * That is acceptable for achievements (forward-only by design).
 */
export class EventBus {
  private readonly handlers = new Map<DomainEventType, Set<DomainEventHandler<DomainEventType>>>();
  private logger: FastifyBaseLogger | undefined;

  /** Attach a logger so swallowed handler errors are still observable. */
  setLogger(logger: FastifyBaseLogger): void {
    this.logger = logger;
  }

  on<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const erased = handler as unknown as DomainEventHandler<DomainEventType>;
    set.add(erased);
    return () => {
      set?.delete(erased);
    };
  }

  /**
   * Fire an event. Returns a promise that resolves when every registered
   * handler has settled, but callers normally do not await it — emits
   * happen after a DB commit and we want the HTTP response to return
   * without waiting for the engine.
   */
  async emit(event: DomainEvent): Promise<void> {
    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) return;
    const runs = [...set].map(async (h) => {
      try {
        await (h as (e: DomainEvent) => void | Promise<void>)(event);
      } catch (err) {
        this.logger?.error({ err, eventType: event.type }, 'event handler threw');
      }
    });
    await Promise.allSettled(runs);
  }
}
