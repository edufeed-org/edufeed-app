/**
 * @typedef {Object} AppSync
 * @property {() => Array<{payload:any, info?:string, document?:string, summary?:string}>} getUpdates
 * @property {(payload:any, meta?:{info?:string, document?:string, summary?:string}) => void} sendState
 * @property {(bytes: Uint8Array) => void} sendRealtime
 * @property {(cb: (bytes: Uint8Array) => void) => (() => void)} onRealtime
 * @property {(cb: () => void) => (() => void)} subscribe
 */

/**
 * Phase 1 AppSync backend: single-participant, durable in localStorage so solo
 * progress (quiz answers, xAPI results) survives reload. Phase 2 swaps in a
 * community-backed implementation of the same interface.
 */

/** @param {string} storageKey @returns {AppSync} */
export function createLocalSync(storageKey) {
  /** @type {Array<{payload:any, info?:string, document?:string, summary?:string}>} */
  let updates = [];
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) updates = JSON.parse(stored);
    if (!Array.isArray(updates)) updates = [];
  } catch {
    updates = [];
  }

  const subscribers = new Set();

  return {
    getUpdates: () => updates,
    sendState(payload, meta) {
      updates = [
        ...updates,
        {
          payload,
          ...(meta?.info && { info: meta.info }),
          ...(meta?.document && { document: meta.document }),
          ...(meta?.summary && { summary: meta.summary })
        }
      ];
      try {
        localStorage.setItem(storageKey, JSON.stringify(updates));
      } catch {
        // quota exceeded — state stays in memory for this session
      }
      for (const cb of subscribers) cb();
    },
    sendRealtime() {
      // single participant: realtime frames go to *other* peers, so nothing to do
    },
    onRealtime() {
      return () => {};
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }
  };
}
