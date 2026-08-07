/**
 * IndexedDB persistence for the Cordn groups spike — one KV object store per
 * user, namespaced `cordn:<pubkey>` (same convention as Concord's storage).
 * Browser-only: never import from SSR-reachable code.
 */

const STORE = 'kv';

/** @param {string} pubkey */
function openDatabase(pubkey) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`cordn:${pubkey}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class CordnStorage {
  /** @param {string} pubkey */
  constructor(pubkey) {
    this.dbPromise = openDatabase(pubkey);
  }

  /**
   * @param {'readonly' | 'readwrite'} mode
   * @param {(store: IDBObjectStore) => IDBRequest} operation
   */
  async #run(mode, operation) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const request = operation(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** @param {string} key */
  get(key) {
    return this.#run('readonly', (store) => store.get(key));
  }

  /**
   * @param {string} key
   * @param {unknown} value
   */
  set(key, value) {
    return this.#run('readwrite', (store) => store.put(value, key));
  }

  /** @param {string} key */
  delete(key) {
    return this.#run('readwrite', (store) => store.delete(key));
  }

  async close() {
    (await this.dbPromise).close();
  }
}
