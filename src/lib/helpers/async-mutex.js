// A minimal FIFO async mutex: `run(fn)` queues `fn` and resolves with its
// result once every previously-queued section has finished. Used to serialize
// read-await-write critical sections that share mutable state across an await
// boundary (cordn's MLS ClientState — see client.svelte.js).
export class AsyncMutex {
  constructor() {
    /** Tail of the queue: resolves when the lock is free. @type {Promise<void>} */
    this.tail = Promise.resolve();
  }

  /**
   * Run `fn` exclusively. Sections run in call order; one runs to completion
   * (including its awaits) before the next starts. The lock is released even
   * if `fn` throws, and the rejection propagates to this call's caller only.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  run(fn) {
    const result = this.tail.then(fn);
    // Chain the NEXT waiter on completion regardless of outcome, but don't let
    // a rejection poison the queue.
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
