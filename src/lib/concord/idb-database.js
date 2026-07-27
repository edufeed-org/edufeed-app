// IAsyncEventDatabase<Rumor> over IndexedDB, one DB per account, one logical
// plane per (communityId, planeKey). Planes are small (the package caps
// channel cache at 300 rumors) so reads load the plane via index and match in JS.
//
// NOTE: `matchFilters` from 'applesauce-core-concord/helpers' resolves fine but can't be
// used here — its `getIndexableTags()` only indexes single-letter tag names (NIP-01), while
// applesauce-concord's own kind-3308 control editions use multi-letter tags (e.g. `vsk`).
// A `#vsk` filter against matchFilters() never matches, verified directly against the
// installed package. `matchFilters` below is a local equivalent that also supports
// arbitrary-length tag names; ids/kinds/authors/since/until semantics are unchanged.
// Known difference: the local matcher does NOT implement upstream's NIP-91 `&`-prefixed
// AND-tag filters (unused anywhere in applesauce-concord today).

/** @typedef {import('applesauce-core-concord/helpers').Rumor} Rumor */
/** @typedef {import('applesauce-core-concord/helpers').Filter} Filter */
/** @typedef {{ key: string, plane: string, event: Rumor }} RumorRecord */

/**
 * @param {Filter} filter
 * @param {Rumor} event
 * @returns {boolean}
 */
function matchFilter(filter, event) {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const key of Object.keys(filter)) {
    if (key[0] !== '#') continue;
    const values = filter[/** @type {`#${string}`} */ (key)];
    if (!values || values.length === 0) continue;
    const tagName = key.slice(1);
    const tagValues = event.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
    if (!values.some((v) => tagValues.includes(v))) return false;
  }
  return true;
}

/**
 * @param {Filter[]} filters
 * @param {Rumor} event
 * @returns {boolean}
 */
function matchFilters(filters, event) {
  return filters.some((f) => matchFilter(f, event));
}

const DB_VERSION = 1;
/** @type {Map<string, Promise<IDBDatabase>>} */
const connections = new Map();

/** @param {string} dbName @returns {Promise<IDBDatabase>} */
export function openConcordDb(dbName) {
  let cached = connections.get(dbName);
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rumors')) {
        const store = db.createObjectStore('rumors', { keyPath: 'key' });
        store.createIndex('byPlane', 'plane', { unique: false });
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  connections.set(dbName, cached);
  return cached;
}

/** Close and delete an account's Concord DB (logout / leave-all). @param {string} dbName */
export async function deleteConcordDb(dbName) {
  const cached = connections.get(dbName);
  if (cached) {
    (await cached).close();
    connections.delete(dbName);
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(undefined);
  });
}

/**
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Implements the async event database contract applesauce's AsyncRumorStore needs. */
export class ConcordIdbEventDatabase {
  /** @param {string} dbName @param {string} plane */
  constructor(dbName, plane) {
    this.dbName = dbName;
    this.plane = plane;
  }

  /** @param {'readonly'|'readwrite'} mode @returns {Promise<IDBObjectStore>} */
  async store(mode) {
    const db = await openConcordDb(this.dbName);
    return db.transaction('rumors', mode).objectStore('rumors');
  }

  /** @param {string} id @returns {string} */
  key(id) {
    return `${this.plane}:${id}`;
  }

  /** All rumors of this plane. @returns {Promise<Rumor[]>} */
  async all() {
    const store = await this.store('readonly');
    const records = /** @type {RumorRecord[]} */ (
      await promisify(store.index('byPlane').getAll(this.plane))
    );
    return records.map((r) => r.event);
  }

  /** @param {Rumor} event @returns {Promise<Rumor>} */
  async add(event) {
    const store = await this.store('readwrite');
    await promisify(store.put({ key: this.key(event.id), plane: this.plane, event }));
    return event;
  }

  /** @param {string | Rumor} event @returns {Promise<boolean>} */
  async remove(event) {
    const id = typeof event === 'string' ? event : event.id;
    const store = await this.store('readwrite');
    const existing = await promisify(store.get(this.key(id)));
    if (!existing) return false;
    await promisify(store.delete(this.key(id)));
    return true;
  }

  /** @param {Filter | Filter[]} filters @returns {Promise<number>} */
  async removeByFilters(filters) {
    const list = Array.isArray(filters) ? filters : [filters];
    const matching = (await this.all()).filter((e) => matchFilters(list, e));
    const store = await this.store('readwrite');
    for (const e of matching) await promisify(store.delete(this.key(e.id)));
    return matching.length;
  }

  /** @param {string} id @returns {Promise<boolean>} */
  async hasEvent(id) {
    const store = await this.store('readonly');
    return (await promisify(store.getKey(this.key(id)))) !== undefined;
  }

  /** @param {string} id @returns {Promise<Rumor | undefined>} */
  async getEvent(id) {
    const store = await this.store('readonly');
    const record = /** @type {RumorRecord | undefined} */ (
      await promisify(store.get(this.key(id)))
    );
    return record?.event;
  }

  /** @param {Filter | Filter[]} filters @returns {Promise<Rumor[]>} */
  async getByFilters(filters) {
    const list = Array.isArray(filters) ? filters : [filters];
    return (await this.all()).filter((e) => matchFilters(list, e));
  }

  /** @param {Filter | Filter[]} filters @returns {Promise<Rumor[]>} */
  async getTimeline(filters) {
    const events = await this.getByFilters(filters);
    return events.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  }

  /**
   * Newest-first versions of one replaceable coordinate; NIP-01 tie-break on
   * equal created_at — the lowest id wins, so it sorts first.
   * @param {Rumor[]} events
   * @param {number} kind
   * @param {string} pubkey
   * @param {string} [identifier]
   * @returns {Rumor[]}
   */
  #replaceableSet(events, kind, pubkey, identifier) {
    return events
      .filter((e) => {
        if (e.kind !== kind || e.pubkey !== pubkey) return false;
        const d = e.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
        return d === (identifier ?? '');
      })
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  }

  /** @param {number} kind @param {string} pubkey @param {string} [identifier] @returns {Promise<boolean>} */
  async hasReplaceable(kind, pubkey, identifier) {
    return this.#replaceableSet(await this.all(), kind, pubkey, identifier).length > 0;
  }

  /** @param {number} kind @param {string} pubkey @param {string} [identifier] @returns {Promise<Rumor | undefined>} */
  async getReplaceable(kind, pubkey, identifier) {
    return this.#replaceableSet(await this.all(), kind, pubkey, identifier)[0];
  }

  /** @param {number} kind @param {string} pubkey @param {string} [identifier] @returns {Promise<Rumor[] | undefined>} */
  async getReplaceableHistory(kind, pubkey, identifier) {
    const set = this.#replaceableSet(await this.all(), kind, pubkey, identifier);
    return set.length ? set : undefined;
  }
}
