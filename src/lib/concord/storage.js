// App-side implementations of the package's pluggable storage contracts:
// ConcordStorage (async KV: keys, membership material, sync cursors) and
// ConcordStoreFactory (per community+plane decrypted-rumor persistence).
import { AsyncRumorStore } from 'applesauce-core-concord';
import { getEventHash } from 'nostr-tools';
import { openConcordDb, ConcordIdbEventDatabase } from './idb-database.js';

/** @typedef {import('applesauce-core-concord/helpers').Rumor} Rumor */

/** DB per account so multi-account sessions don't bleed. @param {string} pubkey @returns {string} */
export function concordDbName(pubkey) {
  return `concord:${pubkey}`;
}

/** Compute a rumor id (event hash of the unsigned event). @param {Omit<Rumor, 'id'> & { id?: string }} template @returns {string} */
export function getRumorId(template) {
  return getEventHash(/** @type {any} */ (template));
}

/** @param {IDBRequest} req @returns {Promise<any>} */
const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * @typedef {object} ConcordStorage
 * @property {(key: string) => Promise<string | null>} getItem
 * @property {(key: string, value: string) => Promise<void>} setItem
 * @property {(key: string) => Promise<void>} removeItem
 */

/**
 * Async KV backed by the `kv` object store — for keys, membership material, sync cursors.
 * @param {string} dbName
 * @returns {ConcordStorage}
 */
export function createConcordStorage(dbName) {
  const store = async (/** @type {'readonly'|'readwrite'} */ mode) => {
    const db = await openConcordDb(dbName);
    return db.transaction('kv', mode).objectStore('kv');
  };
  return {
    async getItem(key) {
      const value = await promisify((await store('readonly')).get(key));
      return value === undefined ? null : value;
    },
    async setItem(key, value) {
      await promisify((await store('readwrite')).put(value, key));
    },
    async removeItem(key) {
      await promisify((await store('readwrite')).delete(key));
    }
  };
}

/**
 * Factory for per (communityId, planeKey) decrypted-rumor stores.
 * @param {string} dbName
 * @returns {(communityId: string, planeKey: string) => AsyncRumorStore}
 */
export function createConcordStoreFactory(dbName) {
  return (communityId, planeKey) =>
    new AsyncRumorStore({
      database: new ConcordIdbEventDatabase(dbName, `${communityId}/${planeKey}`)
    });
}
