/**
 * src/core/events.ts
 * Minimal strongly-typed event bus. The EventMap interface in src/types.ts
 * enumerates every event and payload; subsystems may not invent ad-hoc event
 * names outside that map.
 */

type Handler<P> = (payload: P) => void;

export class EventBus<T extends Record<string, any>> {
  private handlers = new Map<keyof T, Set<Handler<any>>>();

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof T>(event: K, fn: Handler<T[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  /** Subscribe for a single firing. */
  once<K extends keyof T>(event: K, fn: Handler<T[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof T>(event: K, fn: Handler<T[K]>): void {
    this.handlers.get(event)?.delete(fn);
  }

  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy so handlers can unsubscribe during dispatch.
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // One broken listener must not break the dispatch chain.
        console.error(`[events] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
