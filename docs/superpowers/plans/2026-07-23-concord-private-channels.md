# Concord Private Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E2E-encrypted "Private Kanäle" inside Communikey communities via the `applesauce-concord` package, behind `CONCORD_ENABLED`, on a dedicated relay.

**Architecture:** One Concord community per Communikey community (founded by the community owner with their *personal* key), each Kanal a CORD-03 private channel inside it. Public pointer tag in kind 10222. All package access goes through `src/lib/concord/` (wrapper + IndexedDB storage + rune bridges). UI is a new `channels` tab on the community page implementing the "Private Kanäle" design prototype.

**Tech Stack:** SvelteKit / Svelte 5 runes, applesauce-concord (pre-release, exact pin), applesauce-relay RelayPool (existing app instance), IndexedDB, Paraglide i18n, Vitest + fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-23-concord-private-channels-design.md` (committed). Design prototype: claude.ai/design project `d5844719-…`, files `pk-app.jsx`/`pk-views.jsx`/`pk-data.jsx`.

## Global Constraints

- Pin **exactly** `applesauce-concord@0.0.0-concord-20260714212055`. It ships its own nested `applesauce-core@0.0.0-concord-20260714212055` — do NOT upgrade the app's `applesauce-*@^6.2.x` deps.
- Add alias dep `"applesauce-core-concord": "npm:applesauce-core@0.0.0-concord-20260714212055"` — the ONLY way app code may import `AsyncRumorStore`/`matchFilters` from the concord build. Only `src/lib/concord/**` may import it (lint-enforced).
- Everything outside `src/lib/concord/**` imports Concord APIs from `$lib/concord` only (lint-enforced).
- **No Concord import may execute during SSR.** The concord dep tree includes `@noble/hashes` v2, which previously broke SSR chunks (commit a9af9c87). All package loading is dynamic behind `browser` guards.
- Feature flag `CONCORD_ENABLED` (default `false`) hides ALL UI. Relays come from `CONCORD_RELAYS` only — never route Concord traffic through `publishEvent()`'s outbox union or category relay helpers.
- `expires_at`/`expiresAt` in all Concord APIs are unix **seconds**; `CommunityListCommunity.added_at` is ms. Never use `Date.now()` for the former.
- Svelte 5: plain `let` for subscriptions; `$state.raw()` for arrays/Sets/Maps; `$derived` pure; hooks called only during component init.
- All user-facing strings via Paraglide (`messages/de.json` + `messages/en.json`), German copy from the design prototype. No `@` directly before `{param}` in message values (breaks svelte-check).
- TDD: write the failing test first in every task that has testable logic. Commit at the end of every task.
- Work in a **git worktree** rebased onto `dev` (see `superpowers:using-git-worktrees`); copy `.env` from the main checkout.

---

### Task 1: Dependencies, wrapper skeleton, import fence

**Files:**
- Modify: `package.json`
- Modify: `eslint.config.js`
- Create: `src/lib/concord/index.js`

**Interfaces:**
- Produces: `$lib/concord` barrel (empty for now, grows in later tasks); dep alias `applesauce-core-concord`.

- [ ] **Step 1: Install pinned deps**

```bash
pnpm add applesauce-concord@0.0.0-concord-20260714212055
pnpm add applesauce-core-concord@npm:applesauce-core@0.0.0-concord-20260714212055
```

Then edit `package.json` to remove the `^` from both entries (exact pins):

```json
"applesauce-concord": "0.0.0-concord-20260714212055",
"applesauce-core-concord": "npm:applesauce-core@0.0.0-concord-20260714212055",
```

Run `pnpm install` again to sync the lockfile.

- [ ] **Step 2: Create the barrel**

```js
// src/lib/concord/index.js
// Single entry point for all Concord functionality. Everything outside
// src/lib/concord/ must import from here (enforced by no-restricted-imports)
// so pre-1.0 package churn stays contained in this directory.
// Exports grow as the wrapper modules land.
export {};
```

- [ ] **Step 3: Add the lint fence**

In `eslint.config.js`, add a config object to the exported array (after the existing project rules):

```js
{
  files: ['src/**/*.{js,svelte}'],
  ignores: ['src/lib/concord/**'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['applesauce-concord', 'applesauce-concord/*', 'applesauce-core-concord', 'applesauce-core-concord/*'],
            message: 'Import Concord APIs via $lib/concord only (wrapper contains pre-1.0 churn).'
          }
        ]
      }
    ]
  }
},
```

- [ ] **Step 4: Verify build + lint still pass (SSR safety smoke)**

Run: `pnpm run build && pnpm run lint`
Expected: both succeed. (Nothing imports the package yet; this proves the dep install alone doesn't break SSR chunks.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml eslint.config.js src/lib/concord/index.js
git commit -m "feat(concord): pin applesauce-concord + core alias, wrapper barrel, import fence"
```

---

### Task 2: Runtime config (`CONCORD_ENABLED`, `CONCORD_RELAYS`)

**Files:**
- Modify: `src/routes/api/config/+server.js` (next to the `membership:` block, ~line 368)
- Modify: `src/lib/stores/config.svelte.js` (defaultConfig ~line 170, merge ~line 344, getters ~line 457)
- Modify: `.env.example` (if present; otherwise skip)

**Interfaces:**
- Produces: `runtimeConfig.concord` → `{ enabled: boolean, relays: string[] }`.

- [ ] **Step 1: Server config**

In `src/routes/api/config/+server.js`, after the `membership: {...}` block add:

```js
    // Concord E2E-encrypted private channels (Beta). Dedicated relay set —
    // NEVER unioned with outbox/category relays.
    concord: {
      enabled: parseBool(env.CONCORD_ENABLED, false),
      relays: parseArray(env.CONCORD_RELAYS)
    },
```

- [ ] **Step 2: Client config store**

In `src/lib/stores/config.svelte.js`:

defaultConfig (after `membership`):

```js
  // Concord private channels
  concord: {
    enabled: false,
    relays: /** @type {string[]} */ ([])
  },
```

merge block (after the `membership` spread):

```js
    concord: {
      ...defaultConfig.concord,
      ...runtimeConfig.concord
    },
```

getter (after `get membership()`):

```js
  get concord() {
    return config.concord;
  },
```

- [ ] **Step 3: Verify**

Run: `pnpm run check`
Expected: passes. Then `CONCORD_ENABLED=true CONCORD_RELAYS=wss://concord.edufeed.org pnpm run dev` briefly and `curl -s localhost:5173/api/config | grep -o '"concord":{[^}]*}'`
Expected: `"concord":{"enabled":true,"relays":["wss://concord.edufeed.org"]}`

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/config/+server.js src/lib/stores/config.svelte.js
git commit -m "feat(concord): CONCORD_ENABLED / CONCORD_RELAYS runtime config"
```

---

### Task 3: Kind-10222 pointer helpers (TDD)

**Files:**
- Create: `src/lib/concord/pointer.js`
- Test: `src/lib/__tests__/concord-pointer.test.js`

**Interfaces:**
- Produces:
  - `parseConcordPointer(event) → { communityId: string, relay: string|undefined } | undefined`
  - `buildConcordPointerTag(communityId, relay?) → string[]`
  - `withConcordPointer(tags, communityId, relay?) → string[][]` (new array, replaces any existing `concord` tag)

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/concord-pointer.test.js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseConcordPointer,
  buildConcordPointerTag,
  withConcordPointer
} from '$lib/concord/pointer.js';

const CID = 'a'.repeat(64);

describe('buildConcordPointerTag', () => {
  it('builds ["concord", id, relay]', () => {
    expect(buildConcordPointerTag(CID, 'wss://c.example')).toEqual(['concord', CID, 'wss://c.example']);
  });
  it('omits relay when not given', () => {
    expect(buildConcordPointerTag(CID)).toEqual(['concord', CID]);
  });
});

describe('parseConcordPointer', () => {
  it('parses a valid pointer', () => {
    const event = { kind: 10222, tags: [['r', 'wss://x'], ['concord', CID, 'wss://c.example']] };
    expect(parseConcordPointer(event)).toEqual({ communityId: CID, relay: 'wss://c.example' });
  });
  it('returns undefined without a pointer tag', () => {
    expect(parseConcordPointer({ kind: 10222, tags: [] })).toBeUndefined();
  });
  it('rejects malformed community ids (network input!)', () => {
    for (const bad of ['xyz', 'A'.repeat(64), 'a'.repeat(63), '']) {
      expect(parseConcordPointer({ kind: 10222, tags: [['concord', bad]] })).toBeUndefined();
    }
  });
  it('tolerates missing relay', () => {
    expect(parseConcordPointer({ kind: 10222, tags: [['concord', CID]] })).toEqual({
      communityId: CID,
      relay: undefined
    });
  });
  it('handles null/undefined event', () => {
    expect(parseConcordPointer(null)).toBeUndefined();
    expect(parseConcordPointer(undefined)).toBeUndefined();
  });
});

describe('withConcordPointer', () => {
  it('appends when absent, preserving other tags', () => {
    const tags = [['d', ''], ['r', 'wss://x']];
    const out = withConcordPointer(tags, CID, 'wss://c.example');
    expect(out).toEqual([['d', ''], ['r', 'wss://x'], ['concord', CID, 'wss://c.example']]);
    expect(tags).toHaveLength(2); // input untouched
  });
  it('replaces an existing concord tag', () => {
    const out = withConcordPointer([['concord', 'b'.repeat(64)]], CID);
    expect(out).toEqual([['concord', CID]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-pointer.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// src/lib/concord/pointer.js
// Kind-10222 pointer: ["concord", <community_id hex64 lowercase>, <relay?>]
// Makes the EXISTENCE of a community's private area public; contents stay
// encrypted per CORD-01. Spec: docs/superpowers/specs/2026-07-23-concord-private-channels-design.md §3.2

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * @param {string} communityId
 * @param {string} [relay]
 * @returns {string[]}
 */
export function buildConcordPointerTag(communityId, relay) {
  return relay ? ['concord', communityId, relay] : ['concord', communityId];
}

/**
 * Parse the concord pointer from a kind 10222 event. Tag values are untrusted
 * network input — the id is validated as 64-char lowercase hex.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {{ communityId: string, relay: string|undefined } | undefined}
 */
export function parseConcordPointer(event) {
  if (!event || !Array.isArray(event.tags)) return undefined;
  const tag = event.tags.find((t) => t[0] === 'concord');
  if (!tag || !HEX64.test(tag[1] || '')) return undefined;
  return { communityId: tag[1], relay: tag[2] || undefined };
}

/**
 * Return a NEW tags array with the concord pointer set (replacing any existing one).
 * @param {string[][]} tags
 * @param {string} communityId
 * @param {string} [relay]
 * @returns {string[][]}
 */
export function withConcordPointer(tags, communityId, relay) {
  const rest = tags.filter((t) => t[0] !== 'concord');
  return [...rest, buildConcordPointerTag(communityId, relay)];
}
```

Re-export from the barrel — `src/lib/concord/index.js` becomes:

```js
export { parseConcordPointer, buildConcordPointerTag, withConcordPointer } from './pointer.js';
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/__tests__/concord-pointer.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/concord/pointer.js src/lib/concord/index.js src/lib/__tests__/concord-pointer.test.js
git commit -m "feat(concord): kind-10222 pointer build/parse helpers"
```

---

### Task 4: IndexedDB event database (`IAsyncEventDatabase<Rumor>`) (TDD)

**Files:**
- Create: `src/lib/concord/idb-database.js`
- Test: `src/lib/__tests__/concord-idb-database.test.js`

**Interfaces:**
- Consumes: `matchFilters` from `applesauce-core-concord/helpers`.
- Produces:
  - `openConcordDb(dbName) → Promise<IDBDatabase>` (cached per name)
  - `deleteConcordDb(dbName) → Promise<void>` (closes + deletes; used on leave/logout)
  - `class ConcordIdbEventDatabase` — `new ConcordIdbEventDatabase(dbName, plane)` implementing the async database contract verified from the concord source: `add`, `remove`, `removeByFilters`, `hasEvent`, `getEvent`, `getByFilters`, `getTimeline`, `hasReplaceable`, `getReplaceable`, `getReplaceableHistory`.

Object-store layout (one DB per account): store `rumors` with `keyPath: 'key'` (`key = plane + ':' + id`), index `byPlane` on `plane`; store `kv` (out-of-line keys, used by Task 5). Planes are small (the package caps channel cache at 300), so filter queries load the plane via the index and match in JS with `matchFilters`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/concord-idb-database.test.js
/** @vitest-environment node */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { ConcordIdbEventDatabase, deleteConcordDb } from '$lib/concord/idb-database.js';

const DB = 'concord-test';
const rumor = (id, kind = 9, created_at = 100, tags = [], pubkey = 'p'.repeat(64)) => ({
  id: id.repeat(64).slice(0, 64),
  kind,
  created_at,
  tags,
  content: 'hi',
  pubkey
});

afterEach(async () => {
  await deleteConcordDb(DB);
});

describe('ConcordIdbEventDatabase', () => {
  it('add + getEvent + hasEvent roundtrip', async () => {
    const db = new ConcordIdbEventDatabase(DB, 'c1/chat');
    const e = rumor('a');
    await db.add(e);
    expect(await db.hasEvent(e.id)).toBe(true);
    expect(await db.getEvent(e.id)).toEqual(e);
  });

  it('planes are isolated', async () => {
    const chat = new ConcordIdbEventDatabase(DB, 'c1/chat');
    const control = new ConcordIdbEventDatabase(DB, 'c1/control');
    const e = rumor('a');
    await chat.add(e);
    expect(await control.hasEvent(e.id)).toBe(false);
    expect(await control.getByFilters([{}])).toEqual([]);
  });

  it('getTimeline filters by kind and sorts newest-first', async () => {
    const db = new ConcordIdbEventDatabase(DB, 'c1/chat');
    await db.add(rumor('a', 9, 100));
    await db.add(rumor('b', 9, 300));
    await db.add(rumor('c', 7, 200));
    const timeline = await db.getTimeline([{ kinds: [9] }]);
    expect(timeline.map((e) => e.created_at)).toEqual([300, 100]);
  });

  it('getByFilters supports tag filters', async () => {
    const db = new ConcordIdbEventDatabase(DB, 'c1/control');
    await db.add(rumor('a', 3308, 100, [['vsk', '2']]));
    await db.add(rumor('b', 3308, 200, [['vsk', '4']]));
    const out = await db.getByFilters([{ kinds: [3308], '#vsk': ['4'] }]);
    expect(out).toHaveLength(1);
    expect(out[0].created_at).toBe(200);
  });

  it('remove and removeByFilters', async () => {
    const db = new ConcordIdbEventDatabase(DB, 'c1/chat');
    const a = rumor('a', 9, 100);
    await db.add(a);
    await db.add(rumor('b', 7, 200));
    expect(await db.remove(a.id)).toBe(true);
    expect(await db.hasEvent(a.id)).toBe(false);
    expect(await db.removeByFilters([{ kinds: [7] }])).toBe(1);
    expect(await db.getByFilters([{}])).toEqual([]);
  });

  it('replaceable helpers pick newest per (kind,pubkey,d)', async () => {
    const db = new ConcordIdbEventDatabase(DB, 'c1/control');
    const pk = 'f'.repeat(64);
    await db.add(rumor('a', 33301, 100, [['d', 'x']], pk));
    await db.add(rumor('b', 33301, 200, [['d', 'x']], pk));
    expect(await db.hasReplaceable(33301, pk, 'x')).toBe(true);
    expect((await db.getReplaceable(33301, pk, 'x'))?.created_at).toBe(200);
    const history = await db.getReplaceableHistory(33301, pk, 'x');
    expect(history?.map((e) => e.created_at)).toEqual([200, 100]);
    expect(await db.getReplaceable(33301, pk, 'other')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-idb-database.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// src/lib/concord/idb-database.js
// IAsyncEventDatabase<Rumor> over IndexedDB, one DB per account, one logical
// plane per (communityId, planeKey). Planes are small (package caps channel
// cache at 300 rumors) so reads load the plane via index and match in JS.
import { matchFilters } from 'applesauce-core-concord/helpers';

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

/** @param {IDBRequest} req @returns {Promise<any>} */
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

  key(id) {
    return `${this.plane}:${id}`;
  }

  /** All rumors of this plane. @returns {Promise<any[]>} */
  async all() {
    const store = await this.store('readonly');
    const records = await promisify(store.index('byPlane').getAll(this.plane));
    return records.map((r) => r.event);
  }

  async add(event) {
    const store = await this.store('readwrite');
    await promisify(store.put({ key: this.key(event.id), plane: this.plane, event }));
    return event;
  }

  async remove(event) {
    const id = typeof event === 'string' ? event : event.id;
    const store = await this.store('readwrite');
    const existing = await promisify(store.get(this.key(id)));
    if (!existing) return false;
    await promisify(store.delete(this.key(id)));
    return true;
  }

  async removeByFilters(filters) {
    const list = Array.isArray(filters) ? filters : [filters];
    const matching = (await this.all()).filter((e) => matchFilters(list, e));
    const store = await this.store('readwrite');
    for (const e of matching) await promisify(store.delete(this.key(e.id)));
    return matching.length;
  }

  async hasEvent(id) {
    const store = await this.store('readonly');
    return (await promisify(store.getKey(this.key(id)))) !== undefined;
  }

  async getEvent(id) {
    const store = await this.store('readonly');
    const record = await promisify(store.get(this.key(id)));
    return record?.event;
  }

  async getByFilters(filters) {
    const list = Array.isArray(filters) ? filters : [filters];
    return (await this.all()).filter((e) => matchFilters(list, e));
  }

  async getTimeline(filters) {
    const events = await this.getByFilters(filters);
    return events.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  }

  /** @param {any[]} events @param {number} kind @param {string} pubkey @param {string} [identifier] */
  #replaceableSet(events, kind, pubkey, identifier) {
    return events
      .filter((e) => {
        if (e.kind !== kind || e.pubkey !== pubkey) return false;
        const d = e.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
        return d === (identifier ?? '');
      })
      .sort((a, b) => b.created_at - a.created_at);
  }

  async hasReplaceable(kind, pubkey, identifier) {
    return this.#replaceableSet(await this.all(), kind, pubkey, identifier).length > 0;
  }

  async getReplaceable(kind, pubkey, identifier) {
    return this.#replaceableSet(await this.all(), kind, pubkey, identifier)[0];
  }

  async getReplaceableHistory(kind, pubkey, identifier) {
    const set = this.#replaceableSet(await this.all(), kind, pubkey, identifier);
    return set.length ? set : undefined;
  }
}
```

Note: `import { matchFilters } from 'applesauce-core-concord/helpers'` is allowed here (inside `src/lib/concord/`). If the subpath export differs, check `node_modules/applesauce-core-concord/package.json` `exports` and use the correct one (root export also re-exports helpers).

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/__tests__/concord-idb-database.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/concord/idb-database.js src/lib/__tests__/concord-idb-database.test.js
git commit -m "feat(concord): IndexedDB async event database for rumor persistence"
```

---

### Task 5: `ConcordStorage` KV + store factory (TDD)

**Files:**
- Create: `src/lib/concord/storage.js`
- Test: `src/lib/__tests__/concord-storage.test.js`

**Interfaces:**
- Consumes: `openConcordDb`, `ConcordIdbEventDatabase` (Task 4); `AsyncRumorStore` from `applesauce-core-concord`.
- Produces:
  - `concordDbName(pubkey) → string` (`concord:<pubkey>`)
  - `createConcordStorage(dbName) → ConcordStorage` (`getItem/setItem/removeItem`, all Promise-based, backed by the `kv` object store)
  - `createConcordStoreFactory(dbName) → (communityId, planeKey) => AsyncRumorStore`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/concord-storage.test.js
/** @vitest-environment node */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import {
  concordDbName,
  createConcordStorage,
  createConcordStoreFactory
} from '$lib/concord/storage.js';
import { deleteConcordDb } from '$lib/concord/idb-database.js';

const DB = concordDbName('e'.repeat(64));

afterEach(async () => {
  await deleteConcordDb(DB);
});

describe('createConcordStorage', () => {
  it('get/set/remove roundtrip, null when missing', async () => {
    const kv = createConcordStorage(DB);
    expect(await kv.getItem('x')).toBeNull();
    await kv.setItem('x', 'v1');
    expect(await kv.getItem('x')).toBe('v1');
    await kv.removeItem('x');
    expect(await kv.getItem('x')).toBeNull();
  });
});

describe('createConcordStoreFactory', () => {
  it('returns a rumor store satisfying the package contract (add/getTimeline/getByFilters/timeline/model/dispose)', async () => {
    const factory = createConcordStoreFactory(DB);
    const store = factory('c'.repeat(64), 'chat');
    for (const method of ['add', 'getTimeline', 'getByFilters', 'timeline', 'model', 'dispose']) {
      expect(typeof store[method], method).toBe('function');
    }
    const e = {
      id: 'a'.repeat(64),
      kind: 9,
      created_at: 100,
      tags: [],
      content: 'hi',
      pubkey: 'p'.repeat(64)
    };
    // AsyncRumorStore verifies rumors by recomputing the id — use a real one.
    const { getRumorId } = await import('$lib/concord/storage.js');
    const real = { ...e, id: getRumorId(e) };
    await store.add(real);
    const timeline = await store.getTimeline([{ kinds: [9] }]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toBe(real.id);
    store.dispose();
  });

  it('persists across store instances (same plane, new factory)', async () => {
    const { getRumorId } = await import('$lib/concord/storage.js');
    const e = { kind: 9, created_at: 101, tags: [], content: 'persist', pubkey: 'p'.repeat(64) };
    const rumor = { ...e, id: getRumorId(e) };
    const s1 = createConcordStoreFactory(DB)('c'.repeat(64), 'chat');
    await s1.add(rumor);
    s1.dispose();
    const s2 = createConcordStoreFactory(DB)('c'.repeat(64), 'chat');
    const timeline = await s2.getTimeline([{}]);
    expect(timeline.map((r) => r.id)).toContain(rumor.id);
    s2.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-storage.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// src/lib/concord/storage.js
// App-side implementations of the package's pluggable storage contracts:
// ConcordStorage (async KV: keys, membership material, sync cursors) and
// ConcordStoreFactory (per community+plane decrypted-rumor persistence).
import { AsyncRumorStore } from 'applesauce-core-concord';
import { getEventHash } from 'nostr-tools';
import { openConcordDb, ConcordIdbEventDatabase } from './idb-database.js';

/** DB per account so multi-account sessions don't bleed. @param {string} pubkey */
export function concordDbName(pubkey) {
  return `concord:${pubkey}`;
}

/** Compute a rumor id (event hash of the unsigned event). @param {object} template */
export function getRumorId(template) {
  return getEventHash(/** @type {any} */ (template));
}

/** @param {IDBRequest} req */
const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * @param {string} dbName
 * @returns {{getItem(k:string):Promise<string|null>, setItem(k:string,v:string):Promise<void>, removeItem(k:string):Promise<void>}}
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
 * @param {string} dbName
 * @returns {(communityId: string, planeKey: string) => InstanceType<typeof AsyncRumorStore>}
 */
export function createConcordStoreFactory(dbName) {
  return (communityId, planeKey) =>
    new AsyncRumorStore({
      database: new ConcordIdbEventDatabase(dbName, `${communityId}/${planeKey}`)
    });
}
```

Add to the barrel (`src/lib/concord/index.js`):

```js
export { concordDbName, createConcordStorage, createConcordStoreFactory } from './storage.js';
export { deleteConcordDb } from './idb-database.js';
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/__tests__/concord-storage.test.js src/lib/__tests__/concord-idb-database.test.js`
Expected: PASS. If `AsyncRumorStore`'s constructor/`add` behaves differently than assumed (e.g. requires an options field), read `node_modules/applesauce-core-concord/dist/event-store/async-rumor-store.d.ts` and adjust — do NOT re-implement the store.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concord/storage.js src/lib/concord/index.js src/lib/__tests__/concord-storage.test.js
git commit -m "feat(concord): IndexedDB ConcordStorage + AsyncRumorStore factory"
```

---

### Task 6: Client lifecycle service + rune bridge

**Files:**
- Create: `src/lib/concord/client.svelte.js`
- Create: `src/lib/concord/bridge.svelte.js`
- Modify: `src/lib/concord/index.js`
- Modify: `src/routes/+layout.svelte` (one init call)
- Test: `src/lib/__tests__/concord-bridge.test.js` (bridge only; the lifecycle service is exercised in the e2e task)

**Interfaces:**
- Consumes: `runtimeConfig.concord`, `configReady` (`$lib/stores/config.svelte.js`), `manager` (`$lib/stores/accounts.svelte`), `pool` (`$lib/stores/nostr-infrastructure.svelte`), Task 5 factories.
- Produces:
  - `initConcordService()` — idempotent, browser-only; call once from root layout.
  - `getConcordState() → { phase: 'off'|'starting'|'ready'|'error', client: ConcordClient|undefined, communities: CommunityState[], error: string|null }` (reactive `$state` snapshot)
  - `getConcordClient() → ConcordClient|undefined`
  - `signerHasNip44() → boolean`
  - `useObservable(getObservable, initial) → () => value` (bridge hook, from `bridge.svelte.js`)

- [ ] **Step 1: Write the failing bridge test**

```js
// src/lib/__tests__/concord-bridge.test.js
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';
import { useObservable } from '$lib/concord/bridge.svelte.js';

describe('useObservable', () => {
  it('tracks the observable and cleans up on teardown', () => {
    const subject = new BehaviorSubject(1);
    let getValue;
    const cleanup = $effect.root(() => {
      getValue = useObservable(() => subject, 0);
    });
    flushSync();
    expect(getValue()).toBe(1);
    subject.next(2);
    flushSync();
    expect(getValue()).toBe(2);
    cleanup();
    expect(subject.observers.length).toBe(0);
  });

  it('returns initial when getter yields undefined', () => {
    let getValue;
    const cleanup = $effect.root(() => {
      getValue = useObservable(() => undefined, 'fallback');
    });
    flushSync();
    expect(getValue()).toBe('fallback');
    cleanup();
  });
});
```

(If the project's vitest doesn't compile runes in tests, name the file `concord-bridge.svelte.test.js` — check how existing `.svelte.js` store tests are named under `src/lib/__tests__/` and mirror that.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-bridge.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the bridge**

```js
// src/lib/concord/bridge.svelte.js
/**
 * Bridge an RxJS observable into a Svelte 5 rune. Same pattern as the app's
 * loader/model hooks: call during component init, read via the returned getter.
 * @template T
 * @param {() => import('rxjs').Observable<T> | undefined} getObservable
 * @param {T} initial
 * @returns {() => T}
 */
export function useObservable(getObservable, initial) {
  let value = $state.raw(initial);
  $effect(() => {
    const observable = getObservable();
    if (!observable) {
      value = initial;
      return;
    }
    const subscription = observable.subscribe((next) => {
      value = next;
    });
    return () => subscription.unsubscribe();
  });
  return () => value;
}
```

- [ ] **Step 4: Implement the lifecycle service**

```js
// src/lib/concord/client.svelte.js
// One ConcordClient per logged-in session. Created lazily (dynamic import —
// the concord dep tree pulls @noble/hashes v2 and must never enter SSR
// chunks), torn down on logout/account switch. autoUnlock stays false: zero
// signer calls during initial sync (CORD lists unlock on user action).
import { browser } from '$app/environment';

let state = $state.raw({
  phase: /** @type {'off'|'starting'|'ready'|'error'} */ ('off'),
  client: /** @type {any} */ (undefined),
  communities: /** @type {any[]} */ ([]),
  error: /** @type {string|null} */ (null)
});

let initialized = false;
/** @type {any} */ let currentClient;
/** @type {import('rxjs').Subscription[]} */ let clientSubs = [];

export function getConcordState() {
  return state;
}

export function getConcordClient() {
  return currentClient;
}

/** True when the active signer supports NIP-44 (needed for list save / direct invites / rotation). */
export function signerHasNip44() {
  return !!currentClient?.signer?.nip44;
}

function teardown() {
  for (const sub of clientSubs) sub.unsubscribe();
  clientSubs = [];
  currentClient?.dispose();
  currentClient = undefined;
  state = { phase: 'off', client: undefined, communities: [], error: null };
}

/**
 * Wipe an account's local Concord data (spec §5: logout clears stores).
 * Called from the app's explicit logout action — find it in
 * src/lib/stores/accounts.svelte.js (the code path that removes/deactivates
 * the account, not mere account switching) and call this with the pubkey of
 * the account being logged out. Account SWITCHING must NOT wipe.
 * @param {string} pubkey
 */
export async function wipeConcordData(pubkey) {
  const { concordDbName } = await import('./storage.js');
  const { deleteConcordDb } = await import('./idb-database.js');
  await deleteConcordDb(concordDbName(pubkey));
}

/** @param {any} account */
async function setup(account) {
  const { runtimeConfig } = await import('$lib/stores/config.svelte.js');
  if (!runtimeConfig.concord?.enabled) return;
  const relays = runtimeConfig.concord.relays;
  if (!relays?.length) {
    console.warn('concord: CONCORD_ENABLED without CONCORD_RELAYS — feature disabled');
    return;
  }
  state = { ...state, phase: 'starting' };
  try {
    const [{ ConcordClient }, { pool }, storageModule] = await Promise.all([
      import('applesauce-concord'),
      import('$lib/stores/nostr-infrastructure.svelte'),
      import('./storage.js')
    ]);
    const dbName = storageModule.concordDbName(account.pubkey);
    const client = new ConcordClient({
      signer: account.signer,
      pool,
      relays,
      storage: storageModule.createConcordStorage(dbName),
      storeFactory: storageModule.createConcordStoreFactory(dbName),
      autoUnlock: false,
      autoSaveCommunityList: false,
      watchDirectInvites: !!account.signer?.nip44
    });
    currentClient = client;
    clientSubs.push(
      client.communities$.subscribe((communities) => {
        state = { ...state, communities };
      }),
      client.phase$.subscribe((phase) => {
        state = { ...state, phase: phase === 'idle' ? 'starting' : phase };
      })
    );
    state = { ...state, client };
    await client.start();
  } catch (error) {
    console.error('concord: client start failed', error);
    state = { ...state, phase: 'error', error: String(error?.message || error) };
  }
}

/** Idempotent; call once from the root layout (browser only). */
export async function initConcordService() {
  if (!browser || initialized) return;
  initialized = true;
  const [{ configReady }, { manager }, { combineLatest, Observable }] = await Promise.all([
    import('$lib/stores/config.svelte.js'),
    import('$lib/stores/accounts.svelte'),
    import('rxjs')
  ]);
  const configReady$ = new Observable((subscriber) => {
    const unsubscribe = configReady.subscribe((ready) => subscriber.next(ready));
    return unsubscribe;
  });
  combineLatest([configReady$, manager.active$]).subscribe(async ([ready, account]) => {
    if (!ready) return;
    teardown();
    if (account?.signer) await setup(account);
  });
}
```

Check the exact export name for the account manager in `src/lib/stores/accounts.svelte.js` (`manager` is used at module scope there; if it isn't exported, export it or reuse an existing exported hook) and match it.

Barrel additions:

```js
export { initConcordService, getConcordState, getConcordClient, signerHasNip44, wipeConcordData } from './client.svelte.js';
export { useObservable } from './bridge.svelte.js';
```

Wire `wipeConcordData(pubkey)` into the app's explicit logout flow (the account-removal path in `src/lib/stores/accounts.svelte.js` or the logout UI handler — locate with `grep -rn "removeAccount\|logout" src/lib/stores/accounts.svelte.js src/lib/components/`), guarded by `runtimeConfig.concord?.enabled`.

In `src/routes/+layout.svelte`, inside the existing `onMount`/init script section add:

```js
import { initConcordService } from '$lib/concord';
// ...
initConcordService(); // no-op unless CONCORD_ENABLED
```

- [ ] **Step 5: Run tests + check**

Run: `pnpm vitest run src/lib/__tests__/concord-bridge.test.js && pnpm run check && pnpm run build`
Expected: tests PASS; check and build clean (build proves no SSR leakage — the dynamic imports keep concord out of server chunks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/concord/client.svelte.js src/lib/concord/bridge.svelte.js src/lib/concord/index.js src/routes/+layout.svelte src/lib/__tests__/concord-bridge.test.js
git commit -m "feat(concord): session-scoped ConcordClient lifecycle + rune bridge"
```

---

### Task 7: Community hook + `channels` tab gating

**Files:**
- Create: `src/lib/concord/community.svelte.js`
- Modify: `src/lib/components/community/layout/ContentNavSidebar.svelte`
- Modify: `src/lib/components/community/layout/BottomTabBar.svelte` (same label/icon addition)
- Modify: `src/routes/c/[pubkey]/+page.js` (`validContentTypes` — add `'channels'`)
- Modify: `messages/de.json`, `messages/en.json`
- Test: `src/lib/__tests__/concord-community-hook.test.js` (pure gating helper)

**Interfaces:**
- Consumes: `parseConcordPointer` (Task 3), `getConcordState`/`getConcordClient`/`useObservable` (Task 6).
- Produces:
  - `shouldShowChannelsTab({ enabled, pointer, isOwner, isMember }) → boolean` (pure)
  - `useConcordCommunity(getCommunikeyEvent)` hook → getter returning `{ pointer, community, membership: 'none'|'member', channels, phase, dissolved }` where `community` is the `ConcordCommunity` instance (or undefined) and `channels` is `ChannelView[]` (`{channel_id, name, private, deleted?, accessible}`) filtered to `private && !deleted`.

- [ ] **Step 1: Write the failing test for the pure helper**

```js
// src/lib/__tests__/concord-community-hook.test.js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { shouldShowChannelsTab } from '$lib/concord/community.svelte.js';

describe('shouldShowChannelsTab', () => {
  const base = { enabled: true, pointer: undefined, isOwner: false, isMember: false };
  it('hidden when flag off, regardless of everything else', () => {
    expect(shouldShowChannelsTab({ ...base, enabled: false, pointer: {}, isOwner: true, isMember: true })).toBe(false);
  });
  it('visible for members even without pointer (invite-first join)', () => {
    expect(shouldShowChannelsTab({ ...base, isMember: true })).toBe(true);
  });
  it('visible when pointer exists (non-member sees invite inbox)', () => {
    expect(shouldShowChannelsTab({ ...base, pointer: { communityId: 'x' } })).toBe(true);
  });
  it('visible for owner without pointer (founding affordance)', () => {
    expect(shouldShowChannelsTab({ ...base, isOwner: true })).toBe(true);
  });
  it('hidden otherwise', () => {
    expect(shouldShowChannelsTab(base)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-community-hook.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the hook module**

```js
// src/lib/concord/community.svelte.js
import { parseConcordPointer } from './pointer.js';
import { getConcordState, getConcordClient } from './client.svelte.js';
import { useObservable } from './bridge.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/**
 * Visibility rule for the community "channels" tab (spec §7):
 * flag on AND (member OR pointer exists OR owner).
 * @param {{enabled: boolean, pointer: object|undefined, isOwner: boolean, isMember: boolean}} args
 */
export function shouldShowChannelsTab({ enabled, pointer, isOwner, isMember }) {
  if (!enabled) return false;
  return isMember || !!pointer || isOwner;
}

/**
 * Reactive Concord context for one Communikey community.
 * Call during component init; read via the returned getter.
 * @param {() => any} getCommunikeyEvent kind 10222 event getter
 */
export function useConcordCommunity(getCommunikeyEvent) {
  const getChannels = useObservable(() => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities; // re-run when memberships change
    const community = pointer && getConcordClient()?.getCommunity(pointer.communityId);
    return community?.channels$;
  }, /** @type {any[]} */ ([]));
  const getPhase = useObservable(() => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities;
    return pointer && getConcordClient()?.getCommunity(pointer.communityId)?.phase$;
  }, 'idle');
  const getDissolved = useObservable(() => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities;
    return pointer && getConcordClient()?.getCommunity(pointer.communityId)?.dissolved$;
  }, false);

  return () => {
    const pointer = parseConcordPointer(getCommunikeyEvent());
    const _tick = getConcordState().communities;
    const community = pointer ? getConcordClient()?.getCommunity(pointer.communityId) : undefined;
    return {
      enabled: !!runtimeConfig.concord?.enabled,
      pointer,
      community,
      membership: community ? 'member' : 'none',
      channels: getChannels().filter((c) => c.private && !c.deleted),
      phase: getPhase(),
      dissolved: getDissolved()
    };
  };
}
```

Barrel: add `export { shouldShowChannelsTab, useConcordCommunity } from './community.svelte.js';`

- [ ] **Step 4: Wire the tab**

`src/routes/c/[pubkey]/+page.js`: add `'channels'` to the `validContentTypes` set.

`ContentNavSidebar.svelte` (and `BottomTabBar.svelte`, same pattern): import and gate:

```js
import { LockIcon } from '$lib/components/icons'; // reuse an existing lock icon; check the barrel for the actual name
import { shouldShowChannelsTab, useConcordCommunity } from '$lib/concord';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import * as m from '$lib/paraglide/messages';

const getConcord = useConcordCommunity(() => communityEvent);
const getActiveUser = useActiveUser();
```

Extend `labelMap` with `channels: () => m.concord_tab_label()` and append to the derived tab list:

```js
let contentTypes = $derived.by(() => {
  const base = getCommunityTabs(communityEvent).map((id) => ({
    id,
    label: labelMap[id]?.() ?? id,
    icon: iconMap[id] ?? ChatIcon
  }));
  const concord = getConcord();
  const isOwner = !!communityEvent?.pubkey && communityEvent.pubkey === getActiveUser()?.pubkey;
  if (
    shouldShowChannelsTab({
      enabled: concord.enabled,
      pointer: concord.pointer,
      isOwner,
      isMember: concord.membership === 'member'
    })
  ) {
    // insert after 'chat' to sit next to the public channels
    const chatIndex = base.findIndex((t) => t.id === 'chat');
    base.splice(chatIndex + 1, 0, { id: 'channels', label: m.concord_tab_label(), icon: LockIcon });
  }
  return base;
});
```

Note: owner check by pubkey only covers current-keypair communities; the full owner signal (community signer in the account manager, as in `EditCommunityModal.svelte:404-415`) is wired in Task 9 where founding happens — for tab visibility pubkey-equality plus pointer/membership is sufficient.

Messages (`messages/en.json` / `messages/de.json`):

```json
"concord_tab_label": "Channels",
```
```json
"concord_tab_label": "Kanäle",
```

- [ ] **Step 5: Run tests + check**

Run: `pnpm vitest run src/lib/__tests__/concord-community-hook.test.js && pnpm run check`
Expected: PASS / clean. Manually: with `CONCORD_ENABLED=false` the tab never renders.

- [ ] **Step 6: Commit**

```bash
git add src/lib/concord/community.svelte.js src/lib/concord/index.js src/lib/components/community/layout/ContentNavSidebar.svelte src/lib/components/community/layout/BottomTabBar.svelte "src/routes/c/[pubkey]/+page.js" messages/de.json messages/en.json src/lib/__tests__/concord-community-hook.test.js
git commit -m "feat(concord): channels tab gating + per-community hook"
```

---

### Task 8: `PrivateChannelsView` — rail, empty/founding states, state panes

**Files:**
- Create: `src/lib/components/community/channels/PrivateChannelsView.svelte`
- Create: `src/lib/components/community/channels/ChannelStatePane.svelte`
- Modify: `src/lib/components/community/layout/MainContentArea.svelte`
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes: `useConcordCommunity` (Task 7).
- Produces: `<PrivateChannelsView {communikeyEvent} {communityProfile} communityPubkey={...} />`; internal state machine `pane: 'empty'|'founding'|'syncing'|'chat'|'removed'|'dissolved'`. Later tasks fill the modals it opens via `openOverlay(name)` where `name ∈ 'create'|'invite'|'members'|'explainer'|'backup'|'inbox'`.

- [ ] **Step 1: Mount point**

In `MainContentArea.svelte`, after the `chat` branch:

```svelte
{:else if selectedContentType === 'channels'}
  <PrivateChannelsView
    {communikeyEvent}
    {communityProfile}
    communityPubkey={selectedCommunityId}
  />
```

with `import PrivateChannelsView from '../channels/PrivateChannelsView.svelte';`

- [ ] **Step 2: State pane component**

```svelte
<!-- src/lib/components/community/channels/ChannelStatePane.svelte -->
<script>
  /** Generic centered state card: syncing / removed / dissolved / join / error. */
  let { icon = undefined, title, body = '', small = '', progress = false, children } = $props();
</script>

<div class="flex-1 grid place-items-center p-6">
  <div class="bg-base-100 border border-base-300 rounded-2xl p-8 max-w-md text-center">
    {#if icon}<div class="mx-auto mb-3 w-12 h-12 grid place-items-center rounded-full bg-base-200">{@render icon()}</div>{/if}
    <h3 class="font-extrabold text-lg mb-2">{title}</h3>
    {#if body}<p class="text-base-content/70 text-sm leading-relaxed">{body}</p>{/if}
    {#if progress}
      <progress class="progress progress-primary w-full mt-4"></progress>
    {/if}
    {#if small}<p class="text-xs text-base-content/50 mt-2">{small}</p>{/if}
    {#if children}{@render children()}{/if}
  </div>
</div>
```

- [ ] **Step 3: The view**

```svelte
<!-- src/lib/components/community/channels/PrivateChannelsView.svelte -->
<script>
  import { useConcordCommunity, signerHasNip44 } from '$lib/concord';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import ChannelStatePane from './ChannelStatePane.svelte';
  import ChannelChat from './ChannelChat.svelte';
  import ChannelCreateWizard from './ChannelCreateWizard.svelte';
  import ChannelInviteSheet from './ChannelInviteSheet.svelte';
  import ChannelMembersModal from './ChannelMembersModal.svelte';
  import ChannelExplainer from './ChannelExplainer.svelte';
  import KeyBackupModal from './KeyBackupModal.svelte';
  import InviteInboxModal from './InviteInboxModal.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent, communityProfile = null, communityPubkey = '' } = $props();

  const getConcord = useConcordCommunity(() => communikeyEvent);
  const getActiveUser = useActiveUser();

  let selectedChannelId = $state('');
  /** @type {string|null} */
  let overlay = $state(null);
  let mobileChat = $state(false);

  const concord = $derived(getConcord());
  const isOwner = $derived(
    !!communikeyEvent?.pubkey && communikeyEvent.pubkey === getActiveUser()?.pubkey
  );
  const channels = $derived(concord.channels);
  const activeChannel = $derived(
    channels.find((c) => c.channel_id === selectedChannelId) ?? channels[0]
  );
</script>

<div class="flex h-full min-h-0">
  <!-- rail -->
  <aside class="w-72 shrink-0 border-r border-base-300 bg-base-100 p-3 flex flex-col gap-1 overflow-y-auto {mobileChat ? 'hidden md:flex' : 'flex'}">
    <div class="flex items-center justify-between px-2 pt-2 pb-1">
      <span class="text-xs font-bold uppercase tracking-wider text-base-content/60">{m.concord_rail_private()}</span>
      <span class="badge badge-accent badge-xs font-bold uppercase">Beta</span>
    </div>
    {#each channels as channel (channel.channel_id)}
      <button
        class="btn btn-ghost btn-sm justify-start gap-2 {activeChannel?.channel_id === channel.channel_id ? 'btn-active font-bold' : ''}"
        onclick={() => { selectedChannelId = channel.channel_id; mobileChat = true; }}
        disabled={!channel.accessible}
      >
        🔒 <span class="truncate">{channel.name}</span>
      </button>
    {/each}
    {#if concord.community && isOwner && !concord.dissolved}
      <button class="btn btn-outline btn-sm border-dashed justify-start" onclick={() => (overlay = 'create')}>
        + {m.concord_new_channel()}
      </button>
    {/if}
    {#if signerHasNip44()}
      <button class="btn btn-ghost btn-sm justify-start text-base-content/70" onclick={() => (overlay = 'inbox')}>
        ✉ {m.concord_invites()}
      </button>
    {/if}
  </aside>

  <!-- pane -->
  <section class="flex-1 min-w-0 flex flex-col {mobileChat ? 'flex' : 'hidden md:flex'}">
    {#if !concord.community && isOwner}
      <ChannelStatePane title={m.concord_found_title()} body={m.concord_found_body()}>
        {#snippet children()}
          <button class="btn btn-neutral mt-4" onclick={() => (overlay = 'create')}>🔒 {m.concord_new_channel()}</button>
        {/snippet}
      </ChannelStatePane>
    {:else if !concord.community}
      <ChannelStatePane title={m.concord_no_membership_title()} body={m.concord_no_membership_body()} />
    {:else if concord.phase === 'syncing'}
      <ChannelStatePane title={m.concord_sync_title()} body={m.concord_sync_body()} progress />
    {:else if concord.phase === 'removed'}
      <ChannelStatePane title={m.concord_removed_title()} body={m.concord_removed_body()} small={m.concord_removed_small()} />
    {:else if activeChannel}
      <ChannelChat
        community={concord.community}
        channel={activeChannel}
        dissolved={concord.dissolved}
        {isOwner}
        openOverlay={(name) => (overlay = name)}
        onBack={() => (mobileChat = false)}
      />
    {:else}
      <ChannelStatePane title={m.concord_no_channels_title()} body={m.concord_no_channels_body()} />
    {/if}
  </section>
</div>

{#if overlay === 'create'}
  <ChannelCreateWizard {communikeyEvent} {communityProfile} community={concord.community}
    onClose={() => (overlay = null)}
    onCreated={(channelId) => { overlay = null; selectedChannelId = channelId; mobileChat = true; }} />
{:else if overlay === 'invite' && concord.community && activeChannel}
  <ChannelInviteSheet community={concord.community} channel={activeChannel} onClose={() => (overlay = null)} />
{:else if overlay === 'members' && concord.community && activeChannel}
  <ChannelMembersModal community={concord.community} channel={activeChannel} {isOwner} onClose={() => (overlay = null)} />
{:else if overlay === 'explainer'}
  <ChannelExplainer onClose={() => (overlay = null)} />
{:else if overlay === 'backup'}
  <KeyBackupModal onClose={() => (overlay = null)} />
{:else if overlay === 'inbox'}
  <InviteInboxModal onClose={() => (overlay = null)} />
{/if}
```

For this task, create **placeholder-free but minimal** versions of the five modal components it imports that are built in later tasks — each as a real file rendering `null` is NOT allowed; instead create them in their own tasks and, in THIS task, comment out the imports/branches for components that don't exist yet, leaving only `ChannelStatePane` + rail functional. Uncomment as Tasks 9–13 land (each later task's steps say so).

Messages added in this task (en / de — de first values from the design prototype):

```json
"concord_rail_private": "Private channels", / "Private Kanäle"
"concord_new_channel": "New private channel", / "Neuer privater Kanal"
"concord_invites": "Invitations", / "Einladungen"
"concord_found_title": "Set up the private area", / "Privaten Bereich einrichten"
"concord_found_body": "Create the first end-to-end encrypted channel for this community.", / "Erstelle den ersten Ende-zu-Ende-verschlüsselten Kanal für diese Community."
"concord_no_membership_title": "Private channels", / "Private Kanäle"
"concord_no_membership_body": "Open your invitation to join.", / "Öffne deine Einladung, um beizutreten."
"concord_sync_title": "Loading history", / "Verlauf wird geladen"
"concord_sync_body": "Messages arrive encrypted from the relays and are decrypted on this device.", / "Die Nachrichten kommen verschlüsselt von den Relays und werden auf diesem Gerät entschlüsselt."
"concord_removed_title": "You are no longer a member", / "Du bist kein Mitglied mehr"
"concord_removed_body": "Messages you already received stay readable on this device — new ones no longer reach you.", / "Nachrichten, die du bereits erhalten hast, bleiben auf diesem Gerät lesbar — neue erreichen dich nicht mehr."
"concord_removed_small": "If this was a mistake, an admin can simply invite you again.", / "Wenn das ein Versehen war, kann dich ein Admin einfach neu einladen."
"concord_no_channels_title": "No channels yet", / "Noch keine Kanäle"
"concord_no_channels_body": "Channels you get access to appear here.", / "Kanäle, auf die du Zugriff bekommst, erscheinen hier."
```

(Write them as proper flat JSON entries in both files, mirroring existing key style.)

- [ ] **Step 4: Verify**

Run: `pnpm run check && pnpm run lint`
Expected: clean. Dev-server smoke with `CONCORD_ENABLED=true`: owner of a community sees the tab + founding pane; flag off hides everything. Beware the community layout double-mount (renders children 2–3×) — the hook must not spawn duplicate work (it only reads client state, so it's safe).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/community/channels/ src/lib/components/community/layout/MainContentArea.svelte messages/de.json messages/en.json
git commit -m "feat(concord): PrivateChannelsView rail + state panes"
```

---

### Task 9: Create wizard + founding flow (community, first channel, 10222 pointer)

**Files:**
- Create: `src/lib/components/community/channels/ChannelCreateWizard.svelte`
- Create: `src/lib/concord/founding.js`
- Test: `src/lib/__tests__/concord-founding.test.js`
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (re-enable import)
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes: `getConcordClient`, `withConcordPointer` (Task 3), `runtimeConfig.concord.relays`; community signer resolution pattern from `EditCommunityModal.svelte:404-415` (`communitySigner` — active user's signer for current-keypair communities, else the new-keypair community signer registered in the account manager); `publishEvent` from `$lib/services/publish-service.js`; `eventStore`.
- Produces:
  - `foundConcordArea({ communikeyEvent, communityName, relays, communitySigner }) → Promise<{ community, communityId }>` — creates the Concord community (named after the Communikey community) and publishes the updated 10222 with the pointer tag.
  - `ChannelCreateWizard` — 3 steps per the design: Grundlagen (name/desc) → Einladen (initial member pubkeys from community members) → Wichtig zu wissen (key-loss disclosure + mandatory checkbox). On submit: found area if missing, `community.createChannel(name, { private: true })`, then `community.grantChannelAccess(channelId, pubkey)` per selected member. Calls `onCreated(channelId)`.

- [ ] **Step 1: Write the failing test for the founding helper**

```js
// src/lib/__tests__/concord-founding.test.js
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { buildPointerUpdate } from '$lib/concord/founding.js';

const CID = 'c'.repeat(64);

describe('buildPointerUpdate', () => {
  it('produces an unsigned 10222 template preserving tags/content, adding the pointer', () => {
    const communikeyEvent = {
      kind: 10222,
      pubkey: 'a'.repeat(64),
      created_at: 1000,
      content: 'community definition',
      tags: [['r', 'wss://x'], ['content', 'chat']]
    };
    const template = buildPointerUpdate(communikeyEvent, CID, 'wss://concord.example');
    expect(template.kind).toBe(10222);
    expect(template.content).toBe('community definition');
    expect(template.tags).toContainEqual(['r', 'wss://x']);
    expect(template.tags).toContainEqual(['concord', CID, 'wss://concord.example']);
    expect(template.created_at).toBeGreaterThan(1000);
    expect(template).not.toHaveProperty('id');
    expect(template).not.toHaveProperty('sig');
  });
  it('replaces an existing pointer instead of duplicating', () => {
    const event = { kind: 10222, pubkey: 'a'.repeat(64), created_at: 1, content: '', tags: [['concord', 'b'.repeat(64)]] };
    const template = buildPointerUpdate(event, CID);
    expect(template.tags.filter((t) => t[0] === 'concord')).toEqual([['concord', CID]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-founding.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the founding module**

```js
// src/lib/concord/founding.js
import { withConcordPointer } from './pointer.js';
import { getConcordClient } from './client.svelte.js';

/**
 * Unsigned kind-10222 template with the concord pointer set. Preserves all
 * other tags + content; bumps created_at past the source event.
 * @param {any} communikeyEvent
 * @param {string} communityId
 * @param {string} [relay]
 */
export function buildPointerUpdate(communikeyEvent, communityId, relay) {
  return {
    kind: 10222,
    content: communikeyEvent.content ?? '',
    tags: withConcordPointer(communikeyEvent.tags ?? [], communityId, relay),
    created_at: Math.max(Math.floor(Date.now() / 1000), (communikeyEvent.created_at ?? 0) + 1)
  };
}

/**
 * Found the Concord community backing a Communikey community and publish the
 * pointer. Concord owner = the human owner's PERSONAL key (client signer);
 * the community signer only signs the 10222 update (spec §3.1).
 * @param {{communikeyEvent: any, communityName: string, relays: string[], communitySigner: any}} args
 * @returns {Promise<{community: any, communityId: string}>}
 */
export async function foundConcordArea({ communikeyEvent, communityName, relays, communitySigner }) {
  const client = getConcordClient();
  if (!client) throw new Error('Concord client not ready');
  const community = await client.createNewCommunity(communityName, '', relays);
  const communityId = community.communityId;

  const template = buildPointerUpdate(communikeyEvent, communityId, relays[0]);
  const signed = await communitySigner.signEvent(template);
  const [{ publishEvent }, { eventStore }] = await Promise.all([
    import('$lib/services/publish-service.js'),
    import('$lib/stores/nostr-infrastructure.svelte')
  ]);
  await publishEvent(signed);
  eventStore.add(signed);
  return { community, communityId };
}
```

Barrel: `export { foundConcordArea, buildPointerUpdate } from './founding.js';`

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/__tests__/concord-founding.test.js`
Expected: PASS.

- [ ] **Step 5: Implement the wizard**

```svelte
<!-- src/lib/components/community/channels/ChannelCreateWizard.svelte -->
<script>
  import { foundConcordArea } from '$lib/concord';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent, communityProfile = null, community = undefined, onClose, onCreated } = $props();

  let step = $state(0);
  let name = $state('');
  // NOTE: no description field — CORD ChannelMetadata has no description and
  // createChannel only takes {private, voice}; don't collect what we can't store.
  /** @type {string[]} */
  let selected = $state.raw([]);
  let acknowledged = $state(false);
  let busy = $state(false);

  // Invitable people: community members (kind-30000 profile lists + owner),
  // minus self. Same source SettingsView/MembersView use.
  import { useProfileListAccess } from '$lib/stores/profile-list-access.svelte.js';
  const profileAccess = useProfileListAccess(() => communikeyEvent);
  const invitable = $derived.by(() => {
    const self = manager.active?.pubkey;
    const { allMembers } = getVerifiedMembers(profileAccess, communikeyEvent);
    return allMembers.filter((p) => p !== self);
  });
  const getProfiles = useProfileMap(() => invitable);

  // Resolve the signer that can edit this community's 10222 (same pattern as
  // EditCommunityModal): current-keypair → own signer; new-keypair → the
  // community account's signer registered in the manager.
  const communitySigner = $derived.by(() => {
    const account = manager.accounts.find((a) => a.pubkey === communikeyEvent?.pubkey);
    return account?.signer ?? null;
  });

  function toggle(pubkey) {
    selected = selected.includes(pubkey)
      ? selected.filter((p) => p !== pubkey)
      : [...selected, pubkey];
  }

  async function create() {
    if (busy) return;
    busy = true;
    try {
      let target = community;
      if (!target) {
        const communityName =
          communityProfile?.content ? JSON.parse(communityProfile.content).name : undefined;
        ({ community: target } = await foundConcordArea({
          communikeyEvent,
          communityName: communityName || m.concord_default_area_name(),
          relays: runtimeConfig.concord.relays,
          communitySigner
        }));
      }
      const channelId = await target.createChannel(name.trim(), { private: true });
      for (const pubkey of selected) {
        await target.grantChannelAccess(channelId, pubkey);
      }
      showToast(m.concord_channel_created({ name: name.trim(), count: selected.length }), 'success');
      onCreated(channelId);
    } catch (error) {
      console.error('concord: channel creation failed', error);
      showToast(m.concord_channel_create_failed(), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal modal-open" role="dialog">
  <div class="modal-box max-w-lg">
    <button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" onclick={onClose}>✕</button>
    <h3 class="font-extrabold text-lg flex items-center gap-2">
      🔒 {m.concord_wizard_title()} <span class="badge badge-accent badge-xs uppercase font-bold">Beta</span>
    </h3>
    <p class="text-sm text-base-content/60 mb-4">{m.concord_wizard_subtitle()}</p>

    <ul class="steps steps-horizontal w-full mb-4 text-xs">
      <li class="step {step >= 0 ? 'step-neutral' : ''}">{m.concord_wizard_step1()}</li>
      <li class="step {step >= 1 ? 'step-neutral' : ''}">{m.concord_wizard_step2()}</li>
      <li class="step {step >= 2 ? 'step-neutral' : ''}">{m.concord_wizard_step3()}</li>
    </ul>

    {#if step === 0}
      <label class="form-control mb-3">
        <span class="label-text font-bold mb-1">{m.concord_wizard_name_label()}</span>
        <input class="input input-bordered" bind:value={name} placeholder={m.concord_wizard_name_placeholder()} />
      </label>
      <div class="alert text-sm">{m.concord_wizard_invisible_hint()}</div>
    {:else if step === 1}
      <p class="text-sm text-base-content/70 mb-3">{m.concord_wizard_invite_lead()}</p>
      <div class="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {#each invitable as pubkey (pubkey)}
          <button
            class="btn btn-ghost btn-sm justify-start gap-2 {selected.includes(pubkey) ? 'btn-active' : ''}"
            onclick={() => toggle(pubkey)}
          >
            <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
            <span class="truncate">{getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}</span>
            <span class="ml-auto">{selected.includes(pubkey) ? '✓' : '+'}</span>
          </button>
        {/each}
      </div>
      <div class="alert text-sm mt-3">{m.concord_wizard_link_hint()}</div>
    {:else}
      <div class="rounded-xl border border-warning/40 bg-warning/10 p-4 mb-3 text-sm space-y-3">
        <p><b>{m.concord_wizard_keyloss_title()}</b><br />{m.concord_wizard_keyloss_body()}</p>
        <p><b>{m.concord_wizard_backup_title()}</b><br />{m.concord_wizard_backup_body()}</p>
      </div>
      <label class="flex gap-2 items-start cursor-pointer text-sm font-semibold">
        <input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={acknowledged} />
        {m.concord_wizard_ack()}
      </label>
    {/if}

    <div class="modal-action justify-between">
      {#if step > 0}<button class="btn btn-ghost" onclick={() => (step -= 1)}>{m.concord_back()}</button>{:else}<span></span>{/if}
      {#if step < 2}
        <button class="btn btn-neutral" disabled={step === 0 && !name.trim()} onclick={() => (step += 1)}>{m.concord_next()}</button>
      {:else}
        <button class="btn btn-neutral" disabled={!acknowledged || busy} onclick={create}>
          {#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
          🔒 {m.concord_wizard_create()}
        </button>
      {/if}
    </div>
  </div>
</div>
```

Check `manager.accounts` exists on the account manager (applesauce-accounts `AccountManager.accounts`); if the app wraps it differently, mirror `EditCommunityModal.svelte`'s exact `communitySigner` resolution.

Message keys (en / de): `concord_wizard_title` ("New private channel" / "Neuer privater Kanal"), `concord_wizard_subtitle` ("End-to-end encrypted · invite only" / "Ende-zu-Ende-verschlüsselt · nur für Eingeladene"), `concord_wizard_step1` ("Basics" / "Grundlagen"), `concord_wizard_step2` ("Invite" / "Einladen"), `concord_wizard_step3` ("Good to know" / "Wichtig zu wissen"), `concord_wizard_name_label` ("Channel name" / "Name des Kanals"), `concord_wizard_name_placeholder` ("e.g. Staff room" / "z. B. Lehrer:innenzimmer"), `concord_wizard_invisible_hint` ("Invisible to outsiders — including name, member list and activity." / "Für Außenstehende ist dieser Kanal unsichtbar — auch Name, Mitgliederliste und Aktivität."), `concord_wizard_invite_lead` ("Who should be in from the start? Invitees receive the channel key directly and privately." / "Wen möchtest du von Anfang an dabeihaben? Eingeladene erhalten den Schlüssel des Kanals direkt und privat."), `concord_wizard_link_hint` ("You can add more people later via invite link or QR code." / "Weitere Personen kannst du später per Einladungslink oder QR-Code dazuholen."), `concord_wizard_keyloss_title` ("Your key is the channel." / "Dein Schlüssel ist der Kanal."), `concord_wizard_keyloss_body` ("No server can restore access. If you lose your edufeed key, nobody — not even us — can take over or rescue the channel." / "Es gibt keinen Server, der den Zugang wiederherstellen kann. Verlierst du deinen edufeed-Schlüssel, kann niemand — auch wir nicht — den Kanal übernehmen oder retten."), `concord_wizard_backup_title` ("Back up your key now." / "Sichere deinen Schlüssel jetzt."), `concord_wizard_backup_body` ("Log in on a second device or store a backup — then you're covered." / "Auf einem zweiten Gerät anmelden oder eine Sicherungskopie anlegen — dann bist du auf der sicheren Seite."), `concord_wizard_ack` ("Understood — my key is backed up or I'll back it up right away." / "Verstanden — mein Schlüssel ist gesichert oder ich sichere ihn gleich."), `concord_wizard_create` ("Create channel" / "Kanal erstellen"), `concord_back` ("Back" / "Zurück"), `concord_next` ("Next" / "Weiter"), `concord_default_area_name` ("Private area" / "Privater Bereich"), `concord_channel_created` ("Channel \"{name}\" created — {count} invitation(s) sent" / "Kanal „{name}" erstellt — {count} Einladung(en) verschickt"), `concord_channel_create_failed` ("Could not create the channel" / "Kanal konnte nicht erstellt werden").

Re-enable the `ChannelCreateWizard` import/branch in `PrivateChannelsView.svelte`.

- [ ] **Step 6: Component test for wizard gating**

```js
// src/lib/components/__tests__/ChannelCreateWizard.test.js
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ChannelCreateWizard from '$lib/components/community/channels/ChannelCreateWizard.svelte';

// Mirrors the mocking style of existing component tests in this directory —
// check a neighbor test (e.g. one that mocks $lib/stores/accounts.svelte)
// and reuse its vi.mock setup for accounts/config/profile-list stores.
describe('ChannelCreateWizard', () => {
  const props = {
    communikeyEvent: { kind: 10222, pubkey: 'a'.repeat(64), tags: [], content: '' },
    onClose: () => {},
    onCreated: () => {}
  };

  it('disables Next until a name is entered', async () => {
    render(ChannelCreateWizard, { props });
    const next = screen.getByRole('button', { name: /Next|Weiter/ });
    expect(next).toBeDisabled();
  });

  it('disables Create until the key-loss disclosure is acknowledged', async () => {
    render(ChannelCreateWizard, { props });
    // walk to step 3 via the exposed steps; fill name first
    // (use @testing-library/user-event as the neighboring tests do)
  });
});
```

Complete the second test using the same user-event helpers the neighboring component tests use (fill name → Next → Next → assert Create disabled → check box → assert enabled). If the store mocks make this disproportionate, keep at least the first test and assert the checkbox gating through it.

Run: `pnpm vitest run src/lib/components/__tests__/ChannelCreateWizard.test.js`
Expected: PASS.

- [ ] **Step 7: Verify**

Run: `pnpm vitest run src/lib/__tests__/concord-founding.test.js && pnpm run check && pnpm run lint`
Expected: clean. Dev smoke against a local relay (e2e strfry via `docker compose -f e2e/docker-compose.e2e.yml up strfry` and `CONCORD_RELAYS=ws://localhost:17003`): create channel as community owner; confirm the 10222 pointer is republished (verify with a REQ — relays can shadow-drop, always REQ back).

- [ ] **Step 8: Commit**

```bash
git add src/lib/concord/founding.js src/lib/concord/index.js src/lib/components/community/channels/ChannelCreateWizard.svelte src/lib/components/community/channels/PrivateChannelsView.svelte src/lib/__tests__/concord-founding.test.js src/lib/components/__tests__/ChannelCreateWizard.test.js messages/de.json messages/en.json
git commit -m "feat(concord): create wizard + founding flow with 10222 pointer publish"
```

---

### Task 10: Channel chat pane

**Files:**
- Create: `src/lib/components/community/channels/ChannelChat.svelte`
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (re-enable import)
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes: `community.channelStore(channelId).timeline([{kinds:[9]}]) → Observable<Rumor[]>`; `community.sendMessage(channelId, text)`; `MissingChannelKeyError` (catch by name — `error?.name === 'MissingChannelKeyError'` — since the class lives behind the wrapper); `useObservable`; existing chat helpers: `groupMessagesByDate`, `formatMessageTimestamp`, `getUserDisplayName` from `$lib/helpers/message-utils.js`; `useProfileMap`; `ProfileAvatar`, `NostrContentRenderer`.
- Produces: `<ChannelChat {community} {channel} {dissolved} {isOwner} openOverlay={fn} onBack={fn} />`.

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/components/community/channels/ChannelChat.svelte -->
<script>
  import { useObservable } from '$lib/concord';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import {
    formatMessageTimestamp,
    getUserDisplayName,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { community, channel, dissolved = false, isOwner = false, openOverlay, onBack } = $props();

  const getActiveUser = useActiveUser();
  const getMessages = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{ kinds: [9] }]),
    /** @type {any[]} */ ([])
  );
  // timeline is newest-first; chat renders oldest-first
  const messages = $derived([...getMessages()].reverse());
  const getProfiles = useProfileMap(() => messages.map((r) => r.pubkey));
  const grouped = $derived(groupMessagesByDate(messages));
  const getMembers = useObservable(() => community?.members$, new Set());

  let text = $state('');
  let sending = $state(false);
  let menuOpen = $state(false);
  /** @type {HTMLElement|undefined} */
  let scrollContainer;

  $effect(() => {
    messages.length; // dep
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
  });

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    sending = true;
    try {
      await community.sendMessage(channel.channel_id, body);
      text = '';
    } catch (error) {
      if (error?.name === 'MissingChannelKeyError') showToast(m.concord_no_key_error(), 'error');
      else showToast(m.concord_send_failed(), 'error');
      console.error('concord: send failed', error);
    } finally {
      sending = false;
    }
  }
</script>

<header class="flex items-center gap-3 px-4 py-3 bg-base-100 border-b border-base-300 shrink-0">
  <button class="btn btn-ghost btn-circle btn-sm md:hidden" onclick={onBack}>←</button>
  <div class="flex-1 min-w-0">
    <h2 class="font-extrabold flex items-center gap-2">
      🔒 {channel.name} <span class="badge badge-accent badge-xs uppercase font-bold">Beta</span>
    </h2>
    <p class="text-xs text-base-content/60 truncate">
      {m.concord_chat_subtitle()}
      <button class="link" onclick={() => openOverlay('explainer')}>{m.concord_how_it_works()}</button>
    </p>
  </div>
  <button class="btn btn-ghost btn-sm" onclick={() => openOverlay('members')}>
    👥 {getMembers().size}
  </button>
  <div class="dropdown dropdown-end">
    <button class="btn btn-ghost btn-circle btn-sm" onclick={() => (menuOpen = !menuOpen)}>⋯</button>
    {#if menuOpen}
      <ul class="menu dropdown-content bg-base-100 rounded-box shadow-lg border border-base-300 w-60 z-30 p-1">
        {#if !dissolved}<li><button onclick={() => { menuOpen = false; openOverlay('invite'); }}>{m.concord_menu_invite()}</button></li>{/if}
        <li><button onclick={() => { menuOpen = false; openOverlay('members'); }}>{m.concord_menu_members()}</button></li>
        <li><button onclick={() => { menuOpen = false; openOverlay('backup'); }}>{m.concord_menu_backup()}</button></li>
        {#if isOwner && !dissolved}<li><button class="text-error" onclick={() => { menuOpen = false; openOverlay('dissolve'); }}>{m.concord_menu_dissolve()}</button></li>{/if}
      </ul>
    {/if}
  </div>
</header>

{#if dissolved}
  <div class="px-4 py-2 bg-base-200 text-sm text-base-content/70 border-b border-base-300">
    {m.concord_dissolved_banner()}
  </div>
{/if}

<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3" bind:this={scrollContainer}>
  <div class="text-center text-sm text-base-content/60 max-w-md mx-auto py-3">
    <div class="text-lg">🔒</div>
    <b>{m.concord_genesis_title({ name: channel.name })}</b>
    <p class="text-xs mt-1">{m.concord_genesis_body()}</p>
  </div>
  {#each grouped as group (group.date)}
    <div class="divider text-xs text-base-content/50">{group.date}</div>
    {#each group.messages as message (message.id)}
      {@const mine = message.pubkey === getActiveUser()?.pubkey}
      <div class="chat {mine ? 'chat-end' : 'chat-start'}">
        {#if !mine}
          <div class="chat-image"><ProfileAvatar pubkey={message.pubkey} profile={getProfiles().get(message.pubkey)} size="sm" /></div>
          <div class="chat-header text-xs font-bold">
            {getUserDisplayName(message.pubkey, getProfiles().get(message.pubkey))}
            <time class="opacity-50 font-normal ml-1">{formatMessageTimestamp(message.created_at)}</time>
          </div>
        {/if}
        <div class="chat-bubble {mine ? 'chat-bubble-primary' : ''}">
          <NostrContentRenderer event={message} />
        </div>
      </div>
    {/each}
  {/each}
</div>

{#if dissolved}
  <div class="m-4 p-3 rounded-full bg-base-200 text-center text-sm font-semibold text-base-content/60 shrink-0">
    🔒 {m.concord_read_only()}
  </div>
{:else}
  <form class="flex items-center gap-2 m-4 mt-0 p-1.5 bg-base-100 border border-base-300 rounded-full shrink-0"
    onsubmit={(e) => { e.preventDefault(); send(); }}>
    <input class="input input-ghost flex-1 focus:outline-none" bind:value={text}
      placeholder={m.concord_input_placeholder({ name: channel.name })} />
    <button class="btn btn-neutral btn-circle btn-sm" type="submit" disabled={sending || !text.trim()}>➤</button>
  </form>
{/if}
```

Verify `groupMessagesByDate` accepts unsigned rumors (it reads `created_at` only — check `src/lib/helpers/message-utils.js` and adapt the call if its shape differs, e.g. if it returns `[date, messages]` tuples). Verify `NostrContentRenderer`'s `event` prop works with an unsigned rumor; if it requires `sig`, fall back to rendering `message.content` as plain text with linkification via existing helpers.

Message keys (en / de): `concord_chat_subtitle` ("End-to-end encrypted · only members can read" / "Ende-zu-Ende-verschlüsselt · nur Mitglieder können mitlesen"), `concord_how_it_works` ("How does that work?" / "Wie funktioniert das?"), `concord_menu_invite` ("Invite" / "Einladen"), `concord_menu_members` ("Members" / "Mitglieder"), `concord_menu_backup` ("Back up key" / "Schlüssel sichern"), `concord_menu_dissolve` ("Dissolve channel…" / "Kanal auflösen…"), `concord_dissolved_banner` ("This area was dissolved. History stays readable for members; new messages are no longer possible." / "Dieser Bereich wurde aufgelöst. Der Verlauf bleibt für Mitglieder lesbar, neue Nachrichten sind nicht mehr möglich."), `concord_genesis_title` ("Beginning of \"{name}\"" / "Beginn von „{name}""), `concord_genesis_body` ("Messages here are end-to-end encrypted — only members hold the key." / "Nachrichten hier sind Ende-zu-Ende-verschlüsselt — nur Mitglieder besitzen den Schlüssel."), `concord_read_only` ("Read-only" / "Nur noch Lesen möglich"), `concord_input_placeholder` ("Encrypted message to \"{name}\"…" / "Verschlüsselte Nachricht an „{name}"…"), `concord_no_key_error` ("You don't hold this channel's key" / "Du besitzt den Schlüssel dieses Kanals nicht"), `concord_send_failed` ("Sending failed" / "Senden fehlgeschlagen").

Re-enable `ChannelChat` in `PrivateChannelsView.svelte`.

- [ ] **Step 2: Verify**

Run: `pnpm run check && pnpm run lint`
Expected: clean. Dev smoke: send a message in a channel you created (Task 9 setup); it appears optimistically and survives reload (IndexedDB persistence).

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/community/channels/ChannelChat.svelte src/lib/components/community/channels/PrivateChannelsView.svelte messages/de.json messages/en.json
git commit -m "feat(concord): encrypted channel chat pane"
```

---

### Task 10b: Replies + reactions in the channel chat (spec §7: "replies 1111, reactions 7 as in existing chat")

**Files:**
- Modify: `src/lib/components/community/channels/ChannelChat.svelte`
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes: `community.sendMessage(channelId, text, replyTo?: {id, author})`; `community.react(channelId, target: {id, author}, reaction: string)`; `getReplyParentId(event)` from `$lib/helpers/message-utils.js`; kind-7 rumors from `channelStore(id).timeline([{kinds:[7]}])`.
- Produces: reply affordance + emoji reactions rendered under messages.

- [ ] **Step 1: Reactions data + display**

In `ChannelChat.svelte` add a second timeline subscription and per-message aggregation:

```js
const getReactions = useObservable(
  () => community?.channelStore(channel.channel_id).timeline([{ kinds: [7] }]),
  /** @type {any[]} */ ([])
);
/** message id → Map<emoji, count> */
const reactionsByTarget = $derived.by(() => {
  const map = new Map();
  for (const reaction of getReactions()) {
    const target = reaction.tags?.find((t) => t[0] === 'e')?.[1];
    if (!target) continue;
    const emoji = reaction.content || '👍';
    const perMessage = map.get(target) ?? new Map();
    perMessage.set(emoji, (perMessage.get(emoji) ?? 0) + 1);
    map.set(target, perMessage);
  }
  return map;
});
```

Under each chat bubble render the aggregate plus a react button:

```svelte
<div class="flex gap-1 mt-0.5 {mine ? 'justify-end' : ''}">
  {#each [...(reactionsByTarget.get(message.id) ?? new Map())] as [emoji, count] (emoji)}
    <span class="badge badge-sm badge-ghost">{emoji} {count}</span>
  {/each}
  <button class="btn btn-ghost btn-circle btn-xs opacity-40 hover:opacity-100"
    onclick={() => react(message, '👍')} title={m.concord_react()}>🙂</button>
</div>
```

```js
async function react(message, emoji) {
  try {
    await community.react(channel.channel_id, { id: message.id, author: message.pubkey }, emoji);
  } catch (error) {
    console.error('concord: react failed', error);
  }
}
```

(Phase 1: single default emoji; the full `EmojiPicker` from the public chat can be layered on later without API changes.)

- [ ] **Step 2: Replies**

```js
/** @type {{id: string, author: string, preview: string}|null} */
let replyTo = $state(null);
```

Add a reply button next to the react button:

```svelte
<button class="btn btn-ghost btn-circle btn-xs opacity-40 hover:opacity-100"
  onclick={() => (replyTo = { id: message.id, author: message.pubkey, preview: message.content.slice(0, 80) })}
  title={m.concord_reply()}>↩</button>
```

Above the input, show the active reply context:

```svelte
{#if replyTo}
  <div class="flex items-center gap-2 mx-4 px-3 py-1.5 bg-base-200 rounded-t-xl text-xs">
    ↩ <span class="truncate flex-1">{replyTo.preview}</span>
    <button class="btn btn-ghost btn-circle btn-xs" onclick={() => (replyTo = null)}>✕</button>
  </div>
{/if}
```

In `send()`, pass it through and clear:

```js
await community.sendMessage(channel.channel_id, body, replyTo ?? undefined);
replyTo = null;
```

And render the parent snippet above bubbles that are replies (kind 9 rumors carry the reply e-tag; `getReplyParentId(message)` from `message-utils.js` resolves it — verify its tag convention matches CORD's NIP-C7 shape; if not, read the first `e` tag directly):

```svelte
{#if getReplyParentId(message)}
  {@const parent = messages.find((p) => p.id === getReplyParentId(message))}
  {#if parent}<div class="text-xs text-base-content/50 truncate mb-0.5">↩ {parent.content.slice(0, 80)}</div>{/if}
{/if}
```

Message keys (en / de): `concord_react` ("React" / "Reagieren"), `concord_reply` ("Reply" / "Antworten").

- [ ] **Step 3: Verify + commit**

Run: `pnpm run check && pnpm run lint` — clean. Dev smoke: react to a message (badge appears for both accounts), reply (context bar, parent preview on the sent message).

```bash
git add src/lib/components/community/channels/ChannelChat.svelte messages/de.json messages/en.json
git commit -m "feat(concord): replies + reactions in channel chat"
```

---

### Task 11: Invite sheet (link/QR + direct) and invite inbox

**Files:**
- Create: `src/lib/components/community/channels/ChannelInviteSheet.svelte`
- Create: `src/lib/components/community/channels/InviteInboxModal.svelte`
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (re-enable imports)
- Modify: `src/lib/concord/index.js`
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes:
  - `community.createInvite({ base, label?, channels }) → Promise<ConcordInviteLink>` (`link.url`, `link.token`, `link.revoked`)
  - `client.invites.forCommunity(communityId) → ConcordInviteLink[]`, `client.invites.live$`, `client.invites.revoke(invite)`
  - `community.grantChannelAccess(channelId, pubkey)` (direct invites; requires MANAGE_CHANNELS + signer nip44)
  - `client.directInviteWatcher` → `pending$`, `invites$`, `readPending()`, `dismiss(event)`; accept via `client.joinByBundle(invite.bundle)`
  - `qrcode` npm package (already a dep) — `QRCode.toDataURL(text)`
  - `signerHasNip44()`
- Produces: `<ChannelInviteSheet {community} {channel} onClose />`, `<InviteInboxModal onClose />`.

- [ ] **Step 1: Invite sheet**

```svelte
<!-- src/lib/components/community/channels/ChannelInviteSheet.svelte -->
<script>
  import QRCode from 'qrcode';
  import { getConcordClient, signerHasNip44 } from '$lib/concord';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { community, channel, communikeyEvent = undefined, onClose } = $props();

  let tab = $state('link');
  /** @type {any} */ let invite = $state.raw(undefined);
  let qrDataUrl = $state('');
  let copied = $state(false);
  let revokedNotice = $state(false);
  /** @type {string[]} */ let sent = $state.raw([]);

  const client = getConcordClient();
  const canDirect = signerHasNip44();

  // Reuse the newest live link for this channel or create one.
  $effect(() => {
    if (invite || !client) return;
    const existing = client.invites
      .forCommunity(community.communityId)
      .filter((l) => !l.revoked && l.channels?.includes(channel.channel_id))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (existing) invite = existing;
    else
      community
        .createInvite({ base: window.location.origin, label: channel.name, channels: [channel.channel_id] })
        .then((created) => (invite = created))
        .catch((error) => {
          console.error('concord: createInvite failed', error);
          showToast(m.concord_invite_create_failed(), 'error');
        });
  });

  $effect(() => {
    if (invite?.url) QRCode.toDataURL(invite.url).then((url) => (qrDataUrl = url));
  });

  async function copy() {
    await navigator.clipboard.writeText(invite.url);
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  async function revoke() {
    try {
      await client.invites.revoke(invite);
      invite = undefined; // effect creates a fresh link
      revokedNotice = true;
    } catch (error) {
      console.error('concord: revoke failed', error);
      showToast(m.concord_revoke_failed(), 'error');
    }
  }

  async function directInvite(pubkey) {
    try {
      await community.grantChannelAccess(channel.channel_id, pubkey);
      sent = [...sent, pubkey];
    } catch (error) {
      console.error('concord: direct invite failed', error);
      showToast(m.concord_direct_invite_failed(), 'error');
    }
  }

  import { useProfileListAccess } from '$lib/stores/profile-list-access.svelte.js';
  const profileAccess = useProfileListAccess(() => communikeyEvent);
  const invitable = $derived(getVerifiedMembers(profileAccess, communikeyEvent).allMembers);
  const getProfiles = useProfileMap(() => invitable);
</script>

<div class="modal modal-open" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" onclick={onClose}>✕</button>
    <h3 class="font-extrabold text-lg mb-3">{m.concord_invite_title({ name: channel.name })}</h3>
    <div class="tabs tabs-boxed mb-4">
      <button class="tab {tab === 'link' ? 'tab-active' : ''}" onclick={() => (tab = 'link')}>{m.concord_invite_tab_link()}</button>
      <button class="tab {tab === 'direct' ? 'tab-active' : ''}" onclick={() => (tab = 'direct')} disabled={!canDirect}
        title={canDirect ? '' : m.concord_direct_needs_nip44()}>{m.concord_invite_tab_direct()}</button>
    </div>

    {#if tab === 'link'}
      <p class="text-sm text-base-content/60 mb-3">{m.concord_invite_link_lead()}</p>
      {#if invite}
        <div class="flex items-center gap-2 border border-base-300 rounded-xl p-2 pl-3 mb-3">
          <code class="flex-1 text-xs truncate">{invite.url}</code>
          <button class="btn btn-ghost btn-xs" onclick={copy}>{copied ? m.concord_copied() : m.concord_copy()}</button>
        </div>
        {#if qrDataUrl}<div class="grid place-items-center pb-3"><img src={qrDataUrl} alt="QR" class="w-44 rounded-xl border border-base-300" /></div>{/if}
        {#if revokedNotice}
          <div class="alert alert-success text-sm">{m.concord_revoked_notice()}</div>
        {:else}
          <button class="btn btn-outline btn-error btn-sm w-full justify-start" onclick={revoke}>
            {m.concord_revoke_link()}
            <span class="text-xs font-normal opacity-70 block">{m.concord_revoke_hint()}</span>
          </button>
        {/if}
      {:else}
        <div class="grid place-items-center py-6"><span class="loading loading-spinner"></span></div>
      {/if}
    {:else}
      <p class="text-sm text-base-content/60 mb-3">{m.concord_invite_direct_lead()}</p>
      <div class="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {#each invitable as pubkey (pubkey)}
          <div class="flex items-center gap-2 px-2 py-1">
            <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
            <span class="truncate flex-1 text-sm">{getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}</span>
            {#if sent.includes(pubkey)}
              <span class="text-success text-xs font-semibold">✓ {m.concord_invited()}</span>
            {:else}
              <button class="btn btn-ghost btn-xs" onclick={() => directInvite(pubkey)}>{m.concord_invite_action()}</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Invite inbox**

```svelte
<!-- src/lib/components/community/channels/InviteInboxModal.svelte -->
<script>
  import { getConcordClient, useObservable } from '$lib/concord';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { onClose } = $props();
  const client = getConcordClient();
  const watcher = client?.directInviteWatcher;

  const getPending = useObservable(() => watcher?.pending$, /** @type {any[]} */ ([]));
  const getInvites = useObservable(() => watcher?.invites$, /** @type {any[]} */ ([]));
  let unlocking = $state(false);

  async function unlock() {
    if (!watcher || unlocking) return;
    unlocking = true;
    try {
      await watcher.readPending(); // deliberate decrypt — may prompt the signer
    } finally {
      unlocking = false;
    }
  }

  async function accept(invite) {
    try {
      if (invite.bundle) await client.joinByBundle(invite.bundle);
      await watcher.dismiss(invite.rumor ?? invite);
      showToast(m.concord_invite_accepted(), 'success');
      onClose();
    } catch (error) {
      console.error('concord: accept failed', error);
      showToast(m.concord_invite_accept_failed(), 'error');
    }
  }

  async function decline(invite) {
    await watcher.dismiss(invite.rumor ?? invite);
  }
</script>

<div class="modal modal-open" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" onclick={onClose}>✕</button>
    <h3 class="font-extrabold text-lg mb-3">{m.concord_invites()}</h3>
    {#if getPending().length > 0}
      <div class="alert text-sm mb-3">
        {m.concord_pending_locked({ count: getPending().length })}
        <button class="btn btn-neutral btn-xs" onclick={unlock} disabled={unlocking}>{m.concord_unlock()}</button>
      </div>
    {/if}
    {#if getInvites().length === 0 && getPending().length === 0}
      <p class="text-sm text-base-content/60">{m.concord_no_invites()}</p>
    {/if}
    {#each getInvites() as invite (invite.rumor?.id ?? invite.communityId)}
      <div class="border border-base-300 rounded-xl p-4 mb-2">
        <b class="flex items-center gap-2">🔒 {invite.bundle?.label ?? invite.bundle?.name ?? m.concord_invite_generic()}</b>
        <p class="text-xs text-base-content/60 my-2">{m.concord_invite_from({ inviter: invite.inviter?.slice(0, 12) ?? '?' })}</p>
        <div class="flex gap-2 justify-end">
          <button class="btn btn-ghost btn-sm" onclick={() => decline(invite)}>{m.concord_decline()}</button>
          <button class="btn btn-neutral btn-sm" onclick={() => accept(invite)} disabled={!invite.valid || invite.expired?.()}>{m.concord_accept()}</button>
        </div>
      </div>
    {/each}
  </div>
</div>
```

Message keys (en / de): `concord_invite_title` ("Invite to \"{name}\"" / "In „{name}" einladen"), `concord_invite_tab_link` ("Link & QR" / "Link & QR"), `concord_invite_tab_direct` ("Invite directly" / "Direkt einladen"), `concord_invite_link_lead` ("Anyone who opens this link can join the channel. Only share it with people you trust." / "Wer diesen Link öffnet, kann dem Kanal beitreten. Teile ihn nur mit Personen, denen du vertraust."), `concord_copy` ("Copy" / "Kopieren"), `concord_copied` ("Copied" / "Kopiert"), `concord_revoke_link` ("Revoke link" / "Link widerrufen"), `concord_revoke_hint` ("The current link becomes invalid. Existing members stay." / "Der bisherige Link wird ungültig. Wer schon Mitglied ist, bleibt es."), `concord_revoked_notice` ("Old link revoked — a new link is active. All members remain in the channel." / "Alter Link widerrufen — ein neuer Link ist aktiv. Alle Mitglieder bleiben im Kanal."), `concord_invite_direct_lead` ("The invitation is delivered privately and appears in the person's invite inbox." / "Die Einladung wird privat zugestellt und erscheint im Einladungs-Postfach der Person."), `concord_invited` ("Invited" / "Eingeladen"), `concord_invite_action` ("Invite" / "Einladen"), `concord_direct_needs_nip44` ("Your signer doesn't support NIP-44 — use link invites" / "Dein Signer unterstützt kein NIP-44 — nutze Link-Einladungen"), `concord_invite_create_failed`, `concord_revoke_failed`, `concord_direct_invite_failed` (short error strings both languages), `concord_pending_locked` ("{count} locked invitation(s)" / "{count} verschlüsselte Einladung(en)"), `concord_unlock` ("Unlock" / "Entschlüsseln"), `concord_no_invites` ("No invitations." / "Keine Einladungen."), `concord_invite_generic` ("Private channel" / "Privater Kanal"), `concord_invite_from` ("Direct invitation from {inviter}" / "Direkte Einladung von {inviter}"), `concord_decline` ("Decline" / "Ablehnen"), `concord_accept` ("Accept" / "Annehmen"), `concord_invite_accepted` ("Invitation accepted" / "Einladung angenommen"), `concord_invite_accept_failed` ("Could not accept the invitation" / "Einladung konnte nicht angenommen werden").

Re-enable both imports in `PrivateChannelsView.svelte` and pass `{communikeyEvent}` through to `ChannelInviteSheet`.

- [ ] **Step 3: Verify**

Run: `pnpm run check && pnpm run lint`
Expected: clean. Dev smoke: open invite sheet → link renders + QR; revoke → new link; direct invite to a second account → invite appears in that account's inbox (unlock → accept → channel appears).

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/community/channels/ChannelInviteSheet.svelte src/lib/components/community/channels/InviteInboxModal.svelte src/lib/components/community/channels/PrivateChannelsView.svelte messages/de.json messages/en.json
git commit -m "feat(concord): invite sheet (link/QR/direct) + invite inbox"
```

---

### Task 12: Join-by-link route `/invite/[naddr]`

**Files:**
- Create: `src/routes/invite/[naddr]/+page.js`
- Create: `src/routes/invite/[naddr]/+page.svelte`
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes: `client.joinByLink(url)` (full URL incl. fragment; throws on revoked/invalid); `getConcordState` (wait for `phase === 'ready'`); login state.
- Produces: the route Concord invite links point at (`createInvite` was called with `base = window.location.origin`, giving `/invite/<naddr>#<fragment>`).

- [ ] **Step 1: Route load**

```js
// src/routes/invite/[naddr]/+page.js
export const ssr = false;
export const prerender = false;

export async function load({ params }) {
  return { naddr: params.naddr };
}
```

- [ ] **Step 2: Page**

```svelte
<!-- src/routes/invite/[naddr]/+page.svelte -->
<script>
  import { goto } from '$app/navigation';
  import { getConcordClient, getConcordState } from '$lib/concord';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();
  let phase = $state('idle'); // idle | joining | joined | revoked | error
  let errorMessage = $state('');

  const state = $derived(getConcordState());

  async function join() {
    phase = 'joining';
    try {
      const client = getConcordClient();
      if (!client) throw new Error('client not ready');
      await client.joinByLink(window.location.href);
      phase = 'joined';
      // Community page can't be derived from the bundle alone in every case;
      // go to communities overview — the joined area is reachable from there.
      setTimeout(() => goto('/communities'), 1200);
    } catch (error) {
      console.error('concord: joinByLink failed', error);
      const message = String(error?.message || error);
      phase = /revoked/i.test(message) ? 'revoked' : 'error';
      errorMessage = message;
    }
  }
</script>

<div class="min-h-[70vh] grid place-items-center p-6">
  <div class="bg-base-100 border border-base-300 rounded-2xl p-8 max-w-md text-center">
    {#if !runtimeConfig.concord?.enabled}
      <h3 class="font-extrabold text-lg">{m.concord_join_disabled_title()}</h3>
      <p class="text-sm text-base-content/60 mt-2">{m.concord_join_disabled_body()}</p>
    {:else if !getActiveUser()}
      <h3 class="font-extrabold text-lg">{m.concord_join_login_title()}</h3>
      <p class="text-sm text-base-content/60 mt-2">{m.concord_join_login_body()}</p>
    {:else if phase === 'revoked'}
      <div class="text-2xl mb-2">⚠️</div>
      <h3 class="font-extrabold text-lg">{m.concord_join_revoked_title()}</h3>
      <p class="text-sm text-base-content/60 mt-2">{m.concord_join_revoked_body()}</p>
    {:else if phase === 'error'}
      <div class="text-2xl mb-2">⚠️</div>
      <h3 class="font-extrabold text-lg">{m.concord_join_error_title()}</h3>
      <p class="text-xs text-base-content/50 mt-2 break-all">{errorMessage}</p>
    {:else if phase === 'joined'}
      <div class="text-2xl mb-2">✓</div>
      <h3 class="font-extrabold text-lg">{m.concord_join_success()}</h3>
    {:else}
      <div class="text-2xl mb-2">🔒</div>
      <p class="text-xs font-bold uppercase tracking-wider text-primary">{m.concord_join_overline()}</p>
      <h3 class="font-extrabold text-lg mt-1">{m.concord_join_title()}</h3>
      <p class="text-sm text-base-content/60 mt-2">{m.concord_join_body()}</p>
      <button class="btn btn-neutral mt-4" onclick={join} disabled={phase === 'joining' || state.phase !== 'ready'}>
        {#if phase === 'joining' || state.phase !== 'ready'}<span class="loading loading-spinner loading-sm"></span>{/if}
        🔒 {m.concord_join_action()}
      </button>
    {/if}
  </div>
</div>
```

Message keys (en / de): `concord_join_overline` ("Invitation to a private channel" / "Einladung in einen privaten Kanal"), `concord_join_title` ("Join private channel" / "Privatem Kanal beitreten"), `concord_join_body` ("By joining you receive this channel's key. Messages are end-to-end encrypted — only members can read them." / "Mit dem Beitritt erhältst du den Schlüssel dieses Kanals. Nachrichten sind Ende-zu-Ende-verschlüsselt — nur Mitglieder können sie lesen."), `concord_join_action` ("Join" / "Beitreten"), `concord_join_success` ("Joined — history is loading" / "Beigetreten — der Verlauf wird geladen"), `concord_join_revoked_title` ("This invite link is no longer valid" / "Dieser Einladungslink ist nicht mehr gültig"), `concord_join_revoked_body` ("The link was withdrawn by the channel admins. Just ask for a new invitation." / "Der Link wurde von den Kanal-Admins zurückgezogen. Frag einfach nach einer neuen Einladung."), `concord_join_error_title` ("Joining failed" / "Beitritt fehlgeschlagen"), `concord_join_login_title` ("Log in first" / "Bitte zuerst anmelden"), `concord_join_login_body` ("You need to be logged in to accept this invitation." / "Um diese Einladung anzunehmen, musst du angemeldet sein."), `concord_join_disabled_title` ("Private channels are not enabled" / "Private Kanäle sind nicht aktiviert"), `concord_join_disabled_body` ("This deployment has private channels switched off." / "In dieser Installation sind private Kanäle deaktiviert.").

- [ ] **Step 3: Verify**

Run: `pnpm run check`. Dev smoke: copy an invite link from Task 11, open it in a second browser profile logged in as another account, join, see the channel.

- [ ] **Step 4: Commit**

```bash
git add "src/routes/invite/[naddr]/" messages/de.json messages/en.json
git commit -m "feat(concord): /invite join-by-link route"
```

---

### Task 13: Members modal + moderation (kick = rotate, ban = banlist + rotate)

**Files:**
- Create: `src/lib/components/community/channels/ChannelMembersModal.svelte`
- Create: `src/lib/concord/moderation.js`
- Test: `src/lib/__tests__/concord-moderation.test.js`
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (re-enable import)
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes: `community.members$` (Set), `community.roles$`, `community.grants$`, `community.banlist$`, `community.channelStore(id)`, `community.rotateChannel(channelId, {keep, exclude})`, `community.ban(pubkey)`, `community.canModerate$` — plus `observedAuthors` semantics (who wrote in the channel).
- Produces:
  - `channelMemberList({ observed, self, granted }) → string[]` (pure: observed authors ∪ granted ∪ self, deduped)
  - `kickFromChannel(community, channelId, member, currentMembers) → Promise<void>` — `rotateChannel` keeping everyone except `member` (no community-level kick: the person may be in other channels)
  - `banFromChannel(community, channelId, member, currentMembers) → Promise<void>` — `community.ban(member)` (community-wide banlist blocks re-entry via links) + `rotateChannel` excluding them

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/concord-moderation.test.js
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { channelMemberList, kickFromChannel, banFromChannel } from '$lib/concord/moderation.js';

describe('channelMemberList', () => {
  it('unions observed + granted + self, deduped, self first', () => {
    expect(
      channelMemberList({ observed: ['a', 'b'], granted: ['b', 'c'], self: 'me' })
    ).toEqual(['me', 'a', 'b', 'c']);
  });
});

describe('kickFromChannel / banFromChannel', () => {
  const community = () => ({
    rotateChannel: vi.fn().mockResolvedValue(undefined),
    ban: vi.fn().mockResolvedValue(undefined)
  });

  it('kick rotates keeping everyone but the member, without banning', async () => {
    const c = community();
    await kickFromChannel(c, 'chan1', 'evil', ['me', 'evil', 'friend']);
    expect(c.rotateChannel).toHaveBeenCalledWith('chan1', { keep: ['me', 'friend'], exclude: ['evil'] });
    expect(c.ban).not.toHaveBeenCalled();
  });

  it('ban banlists AND rotates', async () => {
    const c = community();
    await banFromChannel(c, 'chan1', 'evil', ['me', 'evil']);
    expect(c.ban).toHaveBeenCalledWith('evil');
    expect(c.rotateChannel).toHaveBeenCalledWith('chan1', { keep: ['me'], exclude: ['evil'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/concord-moderation.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// src/lib/concord/moderation.js
// Channel-level moderation. Control-plane edits alone do NOT sever key
// access — every removal rotates the channel key ("neues Schloss").

/**
 * Approximate member list of a private channel: authors observed in the
 * channel ∪ members we granted access ∪ self. There is no authoritative
 * per-channel roster in CORD (key possession IS membership) — the UI labels
 * this list as approximate.
 * @param {{observed: string[], granted: string[], self: string|undefined}} args
 * @returns {string[]}
 */
export function channelMemberList({ observed, granted, self }) {
  const set = new Set(self ? [self] : []);
  for (const p of observed) set.add(p);
  for (const p of granted) set.add(p);
  return [...set];
}

/**
 * Remove from this channel only (re-invitable). No community-level kick —
 * the member may legitimately be in other channels.
 */
export async function kickFromChannel(community, channelId, member, currentMembers) {
  const keep = currentMembers.filter((p) => p !== member);
  await community.rotateChannel(channelId, { keep, exclude: [member] });
}

/**
 * Ban: community-wide banlist entry (blocks rejoining via invite links) plus
 * channel key rotation. Messages already on the member's device stay readable
 * — communicated honestly in the confirm dialog.
 */
export async function banFromChannel(community, channelId, member, currentMembers) {
  await community.ban(member);
  const keep = currentMembers.filter((p) => p !== member);
  await community.rotateChannel(channelId, { keep, exclude: [member] });
}
```

Barrel: `export { channelMemberList, kickFromChannel, banFromChannel } from './moderation.js';`

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/__tests__/concord-moderation.test.js`
Expected: PASS.

- [ ] **Step 5: Members modal**

```svelte
<!-- src/lib/components/community/channels/ChannelMembersModal.svelte -->
<script>
  import { useObservable, channelMemberList, kickFromChannel, banFromChannel } from '$lib/concord';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { community, channel, isOwner = false, onClose } = $props();

  const getActiveUser = useActiveUser();
  const getRumors = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{}]),
    /** @type {any[]} */ ([])
  );
  const members = $derived(
    channelMemberList({
      observed: [...new Set(getRumors().map((r) => r.pubkey))],
      granted: [],
      self: getActiveUser()?.pubkey
    })
  );
  const getProfiles = useProfileMap(() => members);

  /** @type {{kind: 'kick'|'ban', pubkey: string}|null} */
  let confirm = $state(null);
  let busy = $state(false);

  async function run() {
    if (!confirm || busy) return;
    busy = true;
    const { kind, pubkey } = confirm;
    try {
      if (kind === 'ban') await banFromChannel(community, channel.channel_id, pubkey, members);
      else await kickFromChannel(community, channel.channel_id, pubkey, members);
      showToast(kind === 'ban' ? m.concord_banned_toast() : m.concord_kicked_toast(), 'success');
      confirm = null;
    } catch (error) {
      console.error('concord: moderation failed', error);
      showToast(m.concord_moderation_failed(), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal modal-open" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" onclick={onClose}>✕</button>
    <h3 class="font-extrabold text-lg">{m.concord_members_title()} <span class="text-sm font-mono text-base-content/50">{members.length}</span></h3>
    <p class="text-xs text-base-content/60 mb-3">{m.concord_members_note()}</p>
    <div class="divide-y divide-base-300">
      {#each members as pubkey (pubkey)}
        {@const self = pubkey === getActiveUser()?.pubkey}
        <div class="flex items-center gap-3 py-2">
          <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
          <span class="flex-1 truncate text-sm font-semibold">
            {getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}{self ? ` ${m.concord_you_suffix()}` : ''}
          </span>
          {#if isOwner && !self}
            <button class="btn btn-ghost btn-xs" title={m.concord_kick()} onclick={() => (confirm = { kind: 'kick', pubkey })}>−</button>
            <button class="btn btn-ghost btn-xs text-error" title={m.concord_ban()} onclick={() => (confirm = { kind: 'ban', pubkey })}>⦸</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if confirm}
  {@const profile = getProfiles().get(confirm.pubkey)}
  {@const name = profile?.name ?? confirm.pubkey.slice(0, 12)}
  <div class="modal modal-open" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="font-extrabold text-lg">
        {confirm.kind === 'ban' ? m.concord_ban_confirm_title({ name }) : m.concord_kick_confirm_title({ name })}
      </h3>
      <p class="text-sm text-base-content/70 my-3">
        {confirm.kind === 'ban' ? m.concord_ban_confirm_body({ name }) : m.concord_kick_confirm_body({ name })}
      </p>
      {#if confirm.kind === 'ban'}
        <p class="text-xs text-base-content/50 bg-base-200 rounded-xl p-3">{m.concord_ban_confirm_note({ name })}</p>
      {/if}
      <div class="modal-action justify-center">
        <button class="btn btn-ghost" onclick={() => (confirm = null)}>{m.concord_cancel()}</button>
        <button class="btn {confirm.kind === 'ban' ? 'btn-error' : 'btn-neutral'}" disabled={busy} onclick={run}>
          {confirm.kind === 'ban' ? m.concord_ban() : m.concord_kick()}
        </button>
      </div>
    </div>
  </div>
{/if}
```

Message keys (en / de): `concord_members_title` ("Members" / "Mitglieder"), `concord_members_note` ("This list is derived from join and activity signals in the channel. It can lag a few minutes." / "Diese Liste entsteht aus Beitritts- und Aktivitätssignalen im Kanal. Sie kann ein paar Minuten hinterherhinken."), `concord_you_suffix` ("(you)" / "(du)"), `concord_kick` ("Remove" / "Entfernen"), `concord_ban` ("Ban" / "Sperren"), `concord_kick_confirm_title` ("Remove {name}?" / "{name} entfernen?"), `concord_kick_confirm_body` ("{name} loses access to new messages in this channel. With a new invitation they can rejoin anytime." / "{name} verliert den Zugang zu neuen Nachrichten in diesem Kanal. Mit einer neuen Einladung kann {name} jederzeit wieder beitreten."), `concord_ban_confirm_title` ("Ban {name}?" / "{name} sperren?"), `concord_ban_confirm_body` ("Banning swaps the channel's lock: all other members automatically receive a new key. {name} can't read anything new — not even with an invite link." / "Beim Sperren wird das Schloss des Kanals ausgetauscht: Alle anderen Mitglieder erhalten automatisch einen neuen Schlüssel. {name} kann nichts Neues mehr lesen — auch nicht mit einem Einladungslink."), `concord_ban_confirm_note` ("Messages {name} already received stay readable on their devices. That cannot technically be undone." / "Nachrichten, die {name} bereits erhalten hat, bleiben auf ihren Geräten lesbar. Das lässt sich technisch nicht zurückholen."), `concord_cancel` ("Cancel" / "Abbrechen"), `concord_kicked_toast` ("Removed" / "Entfernt"), `concord_banned_toast` ("Banned — the channel has a new lock" / "Gesperrt — der Kanal hat ein neues Schloss"), `concord_moderation_failed` ("Action failed" / "Aktion fehlgeschlagen").

Re-enable the import in `PrivateChannelsView.svelte`.

- [ ] **Step 6: Verify + commit**

Run: `pnpm vitest run src/lib/__tests__/concord-moderation.test.js && pnpm run check && pnpm run lint` — expected clean.

```bash
git add src/lib/concord/moderation.js src/lib/concord/index.js src/lib/components/community/channels/ChannelMembersModal.svelte src/lib/components/community/channels/PrivateChannelsView.svelte src/lib/__tests__/concord-moderation.test.js messages/de.json messages/en.json
git commit -m "feat(concord): members modal + kick/ban with channel rekey"
```

---

### Task 14: Explainer, key backup (guidance), dissolve flow

**Files:**
- Create: `src/lib/components/community/channels/ChannelExplainer.svelte`
- Create: `src/lib/components/community/channels/KeyBackupModal.svelte`
- Modify: `src/lib/components/community/channels/ChannelChat.svelte` (key bar; dissolve confirm)
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (re-enable imports; `dissolve` overlay branch)
- Modify: `messages/de.json`, `messages/en.json`

**Interfaces:**
- Consumes: `community.dissolve()` (owner-only, irreversible, tombstones the whole private area → `dissolved$` flips, chat pane becomes read-only via the Task 10 `dissolved` prop); existing nsec-export affordance for npub-login accounts (find it: `grep -rn "nsec" src/lib/components/settings/ src/routes/settings/` — reuse the existing component/flow; if none exists, link to `/settings`).
- Produces: `<ChannelExplainer onClose />`, `<KeyBackupModal onClose />`, dissolve confirm inside `PrivateChannelsView`.

- [ ] **Step 1: Explainer** — static modal, four rows matching the prototype (`PkExplainer`): E2E encryption / invisible from outside / membership = key / open Concord protocol. Same modal skeleton as Task 13's confirm; keys `concord_explainer_title` ("How are private channels protected?" / "Wie sind private Kanäle geschützt?") plus `concord_explainer_row1_title|body` … `row4`, values translated from `pk-views.jsx` `PkExplainer.rows`, and the beta footnote `concord_explainer_beta`.

- [ ] **Step 2: Key backup modal** — two options per the prototype, Phase-1 scope = guidance only (spec decision 5):

```svelte
<!-- src/lib/components/community/channels/KeyBackupModal.svelte -->
<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';
  let { onClose } = $props();
  // npub-login accounts hold a local nsec that can be exported; extension/
  // bunker accounts keep the key in the extension — guidance only.
  const hasLocalKey = $derived(!!manager.active?.metadata?.privateKey || manager.active?.type === 'nsec');
</script>

<div class="modal modal-open" role="dialog">
  <div class="modal-box max-w-md text-center">
    <button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" onclick={onClose}>✕</button>
    <div class="text-2xl">🔑</div>
    <h3 class="font-extrabold text-lg mt-1">{m.concord_backup_title()}</h3>
    <p class="text-sm text-base-content/70 my-3">{m.concord_backup_body()}</p>
    <div class="flex flex-col gap-2 text-left">
      <div class="border border-base-300 rounded-xl p-4">
        <b class="text-sm">{m.concord_backup_device_title()}</b>
        <p class="text-xs text-base-content/60">{m.concord_backup_device_body()}</p>
      </div>
      {#if hasLocalKey}
        <a class="border border-base-300 rounded-xl p-4 hover:border-primary" href="/settings">
          <b class="text-sm">{m.concord_backup_export_title()}</b>
          <p class="text-xs text-base-content/60">{m.concord_backup_export_body()}</p>
        </a>
      {/if}
    </div>
    <div class="modal-action justify-center">
      <button class="btn btn-neutral" onclick={onClose}>{m.concord_done()}</button>
    </div>
  </div>
</div>
```

Check the actual account shape for detecting a local-nsec account (`manager.active.type` / metadata) in `src/lib/stores/accounts.svelte.js` and adjust `hasLocalKey`. Keys (en / de): `concord_backup_title` ("Back up your key" / "Schlüssel sichern"), `concord_backup_body` ("Your key is your access to all private channels. It lives only on your devices — if it's lost, nobody can restore it." / "Dein Schlüssel ist dein Zugang zu allen privaten Kanälen. Er liegt nur auf deinen Geräten — geht er verloren, kann ihn niemand wiederherstellen."), `concord_backup_device_title` ("Sign in on a second device" / "Zweites Gerät anmelden"), `concord_backup_device_body` ("Your channels sync automatically." / "Deine Kanäle synchronisieren sich automatisch."), `concord_backup_export_title` ("Export your key" / "Schlüssel exportieren"), `concord_backup_export_body` ("Open settings to save your secret key securely." / "Öffne die Einstellungen, um deinen geheimen Schlüssel sicher zu speichern."), `concord_done` ("Done" / "Fertig").

- [ ] **Step 3: Key bar in `ChannelChat.svelte`** — dismissible bar above the message list (localStorage flag `concord:keybar-dismissed`):

```svelte
{#if !dissolved && showKeyBar}
  <div class="flex items-center gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-sm shrink-0">
    🔑 <span class="flex-1"><b>{m.concord_keybar_title()}</b> {m.concord_keybar_body()}</span>
    <button class="btn btn-neutral btn-xs" onclick={() => openOverlay('backup')}>{m.concord_keybar_action()}</button>
    <button class="btn btn-ghost btn-circle btn-xs" onclick={dismissKeyBar}>✕</button>
  </div>
{/if}
```

with

```js
let showKeyBar = $state(false);
$effect(() => {
  showKeyBar = !localStorage.getItem('concord:keybar-dismissed');
});
function dismissKeyBar() {
  localStorage.setItem('concord:keybar-dismissed', '1');
  showKeyBar = false;
}
```

Keys: `concord_keybar_title` ("Your key is your access." / "Dein Schlüssel ist dein Zugang."), `concord_keybar_body` ("Without it there's no way back into this channel — back it up once and you're covered." / "Ohne ihn gibt es keinen Weg zurück in diesen Kanal — sichere ihn einmal, dann bist du versorgt."), `concord_keybar_action` ("Back up now" / "Jetzt sichern").

- [ ] **Step 4: Dissolve flow** — in `PrivateChannelsView.svelte` add an overlay branch `'dissolve'` rendering a confirm modal (same skeleton as Task 13's confirm): title `concord_dissolve_title` ("Dissolve the private area?" / "Privaten Bereich auflösen?"), body `concord_dissolve_body` ("This dissolves ALL private channels of this community. History stays readable for members; new messages become impossible. This cannot be undone." / "Damit werden ALLE privaten Kanäle dieser Community aufgelöst. Der Verlauf bleibt für Mitglieder lesbar, neue Nachrichten sind nicht mehr möglich. Das kann nicht rückgängig gemacht werden."), confirm button `concord_dissolve_action` ("Dissolve" / "Auflösen", `btn-error`) calling:

```js
async function dissolve() {
  try {
    await concord.community.dissolve();
    showToast(m.concord_dissolved_toast(), 'success');
    overlay = null;
  } catch (error) {
    console.error('concord: dissolve failed', error);
    showToast(m.concord_dissolve_failed(), 'error');
  }
}
```

(`concord_dissolved_toast` "Private area dissolved" / "Privater Bereich aufgelöst"; `concord_dissolve_failed` "Dissolving failed" / "Auflösen fehlgeschlagen".) Note the scope honestly in the dialog: `dissolve()` is community-level (all channels), matching the package; there is no per-channel hard delete (soft `deleteChannel` is deliberately NOT exposed in Phase 1 UI).

- [ ] **Step 5: Verify + commit**

Run: `pnpm run check && pnpm run lint` — clean. Dev smoke: explainer opens; key bar dismisses and stays dismissed after reload; owner dissolve → tombstone banner + read-only input.

```bash
git add src/lib/components/community/channels/ messages/de.json messages/en.json
git commit -m "feat(concord): explainer, key backup guidance, dissolve flow"
```

---

### Task 15: E2E test (two contexts: create → invite → join → chat → ban)

**Files:**
- Modify: `playwright.config.js` (webServer env: add `CONCORD_ENABLED: 'true'`, `CONCORD_RELAYS: RELAY_URLS.strfry`)
- Create: `e2e/concord-channels.test.js`
- Modify: `e2e/COVERAGE.md`

**Interfaces:**
- Consumes: `loginWithNsec(page, nsec)` from `e2e/fixtures.js`; seeded test users/communities from `e2e/test-data.js` (find a seeded community whose owner nsec is available — check `TEST_AUTHOR` and the community seed events; if no owned community is seeded, the test creates one through the UI first); strfry at `ws://localhost:17003` (stores kind 1059, no policy — fine for tests).

- [ ] **Step 1: Wire env in `playwright.config.js`**

In the `webServer.env` block (line ~57), add:

```js
      CONCORD_ENABLED: 'true',
      CONCORD_RELAYS: RELAY_URLS.strfry,
```

- [ ] **Step 2: Write the test**

```js
// e2e/concord-channels.test.js
import { test, expect } from '@playwright/test';
import { loginWithNsec } from './fixtures.js';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

// Two-browser-context flow over the real strfry:
// owner creates a community + private channel, invites via link;
// guest joins, both exchange messages; owner bans guest; guest stops
// receiving new messages.
test.describe('concord private channels', () => {
  test('create → invite via link → join → exchange → ban', async ({ browser }) => {
    test.setTimeout(180_000);
    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();

    const ownerNsec = nip19.nsecEncode(generateSecretKey());
    const guestNsec = nip19.nsecEncode(generateSecretKey());

    // --- owner: login, create a community (current-keypair), open channels tab
    await loginWithNsec(owner, ownerNsec);
    // Create community via UI: adapt selectors from e2e/community-creation.test.js
    // (reuse its helper steps verbatim; use the "use my keypair" option).
    // ... create community, navigate to /c/<npub>?view=channels

    await owner.getByRole('button', { name: /Neuer privater Kanal|New private channel/ }).click();
    await owner.getByPlaceholder(/Lehrer|Staff/).fill('E2E Secret');
    await owner.getByRole('button', { name: /Weiter|Next/ }).click();
    await owner.getByRole('button', { name: /Weiter|Next/ }).click();
    await owner.getByRole('checkbox').check();
    await owner.getByRole('button', { name: /Kanal erstellen|Create channel/ }).click();
    await expect(owner.getByText('E2E Secret')).toBeVisible({ timeout: 20_000 });

    // --- owner: invite link
    await owner.getByRole('button', { name: '⋯' }).click();
    await owner.getByRole('button', { name: /Einladen|Invite/ }).first().click();
    const link = await owner.locator('code').first().textContent();
    expect(link).toContain('/invite/');

    // --- guest: join by link
    await loginWithNsec(guest, guestNsec);
    await guest.goto(link);
    await guest.getByRole('button', { name: /Beitreten|Join/ }).click();
    await expect(guest.getByText(/Beigetreten|Joined/)).toBeVisible({ timeout: 30_000 });

    // --- exchange messages (guest navigates to the community channels tab)
    // ... navigate guest to the same /c/<npub>?view=channels URL
    const ownerInput = owner.getByPlaceholder(/Verschlüsselte Nachricht|Encrypted message/);
    await ownerInput.fill('hello from owner');
    await ownerInput.press('Enter');
    await expect(guest.getByText('hello from owner')).toBeVisible({ timeout: 30_000 });

    const guestInput = guest.getByPlaceholder(/Verschlüsselte Nachricht|Encrypted message/);
    await guestInput.fill('hello from guest');
    await guestInput.press('Enter');
    await expect(owner.getByText('hello from guest')).toBeVisible({ timeout: 30_000 });

    // --- ban guest, verify severance
    await owner.getByRole('button', { name: /👥/ }).click();
    await owner.getByTitle(/Sperren|Ban/).first().click();
    await owner.getByRole('button', { name: /^Sperren$|^Ban$/ }).click();
    await expect(owner.getByText(/neues Schloss|new lock/)).toBeVisible({ timeout: 30_000 });

    await ownerInput.fill('after the ban');
    await ownerInput.press('Enter');
    // banned context must NOT decrypt the post-rotation message
    await expect(owner.getByText('after the ban')).toBeVisible({ timeout: 30_000 });
    await guest.waitForTimeout(10_000);
    await expect(guest.getByText('after the ban')).not.toBeVisible();

    await ownerContext.close();
    await guestContext.close();
  });
});
```

Fill the two “…” navigation gaps with the exact selectors from `e2e/community-creation.test.js` (community create) — copy the working steps, don't invent new selectors. Where the app under test differs, adapt the assertions to what the UI actually renders (data-testid additions to the components are allowed and preferred over text selectors — add `data-testid="concord-channel-input"` etc. to the components if the text selectors prove flaky).

- [ ] **Step 3: Run**

Run (inside the nix shell): `pnpm run test:e2e -- concord-channels`
Expected: PASS. Iterate on selectors/timing as needed; Concord sync over a local relay is fast but rotation + re-wrap can take a few seconds — prefer `expect(...).toBeVisible({timeout})` polling over fixed waits (the final negative assertion is the exception).

- [ ] **Step 4: Update COVERAGE.md**

Add a section: `concord-channels.test.js — private channels: create wizard, invite link, join-by-link, two-context message exchange, ban + key-rotation severance. Not covered: direct invites (needs second seeded profile with DM relays), dissolve, key backup.`

- [ ] **Step 5: Commit**

```bash
git add playwright.config.js e2e/concord-channels.test.js e2e/COVERAGE.md src/lib/components/community/channels/
git commit -m "test(concord): two-context e2e — create/invite/join/chat/ban"
```

---

### Task 16: Dedicated relay `concord.edufeed.org` (homelab)

**Files (separate repo `/home/laoc/coding/homelab`):** new strfry role instance + Traefik routing, following the existing strfry deployment pattern there. Use the `homelab` agent for this task.

**Requirements (spec §6):**
- strfry storing kind **1059** only (`writePolicy` restricting kinds: accept 1059; reject everything else — including kind 5: no deletions honored in Phase 1, which safely satisfies "reject gift-wrap deletion by author"; p-tag-based deletion support is deferred).
- Ephemeral kinds (21059) are never stored by strfry by default — verify `strfry.conf` keeps ephemeral handling standard.
- **No pubkey allowlisting** and no WoT/author policy: stream authors are throwaway derived keys. Do not reuse relay.edufeed.org's policy plugin.
- Policy plugin must be **awk/sh** (BusyBox container — no python/node/jq).
- NIP-42 supported (strfry default) — Concord uses it for stream-key auth on demand.

- [ ] **Step 1:** In the homelab repo, copy the existing strfry service definition to a `concord-strfry` instance (new domain `concord.edufeed.org`, own LMDB volume). Write the write-policy plugin:

```sh
#!/bin/sh
# concord relay policy: only kind-1059 gift wraps are accepted.
while IFS= read -r line; do
  kind=$(printf '%s' "$line" | awk 'match($0, /"kind":[0-9]+/) { print substr($0, RSTART+7, RLENGTH-7) }')
  id=$(printf '%s' "$line" | awk 'match($0, /"id":"[0-9a-f]{64}"/) { print substr($0, RSTART+6, 64) }')
  if [ "$kind" = "1059" ]; then
    printf '{"id":"%s","action":"accept"}\n' "$id"
  else
    printf '{"id":"%s","action":"reject","msg":"blocked: only kind 1059 accepted"}\n' "$id"
  fi
done
```

(Adapt to the exact plugin input framing used by the existing strfry policy scripts in the homelab repo — one JSON event per line on stdin, one JSON verdict per line on stdout. The awk extraction pattern above assumes strfry's `"kind":N` serialization; verify against an existing working plugin there.)

- [ ] **Step 2:** Deploy via the repo's Ansible playbook; verify from this machine with Node's global WebSocket (zero-dep check):

```bash
node -e '
const ws = new WebSocket("wss://concord.edufeed.org");
ws.onopen = () => { ws.send(JSON.stringify(["REQ","ping",{kinds:[1059],limit:1}])); };
ws.onmessage = (m) => { console.log(m.data); if (JSON.parse(m.data)[0]==="EOSE") process.exit(0); };
ws.onerror = (e) => { console.error("ERR", e.message); process.exit(1); };
'
```

Expected: an `EOSE` line. Also verify a kind-1 publish is rejected and a valid kind-1059 publish is accepted **and returned by a follow-up REQ** (relays acking then shadow-dropping is a known failure mode).

- [ ] **Step 3:** Set `CONCORD_ENABLED=true`, `CONCORD_RELAYS=wss://concord.edufeed.org` in the **dev** deployment env (edufeed-app-dev) only; prod keeps the flag off.

- [ ] **Step 4:** Commit in the homelab repo (its own conventions).

---

### Task 17: Docs — CLAUDE.md + canary note

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Add to the CLAUDE.md event-kind table and a new short section:

```markdown
## Concord Private Channels (CORD, Beta)

E2E-encrypted channels inside communities via `applesauce-concord` (pre-release,
exact-pinned together with the `applesauce-core-concord` alias — bump both in
lockstep and review diffs; run the package's own vitest suite as a canary:
`cd $(mktemp -d) && npm pack applesauce-concord@concord` or test in the
applesauce repo's concord branch).

- All app access goes through `src/lib/concord/` (lint-enforced). Never import
  `applesauce-concord` or `applesauce-core-concord` elsewhere.
- One Concord community per Communikey community; pointer tag
  `["concord", <id>, <relay>]` on kind 10222. Kanäle = CORD-03 private channels.
- Kind 1059 traffic goes ONLY to `CONCORD_RELAYS` (never outbox/category
  relays; never through curated/WoT filtering).
- Feature flag `CONCORD_ENABLED` (default off). Spec:
  `docs/superpowers/specs/2026-07-23-concord-private-channels-design.md`.
- Concord code must never enter SSR chunks (dep tree has @noble/hashes v2 —
  see commit a9af9c87); the wrapper uses browser-guarded dynamic imports.
- Curated/WoT/gated modes need no Concord-specific code: Concord traffic never
  flows through the app's loaders or feed queries (the client subscribes
  directly with stream-author filters on its own relays), so author filtering
  cannot touch it. Do not "fix" this by adding kind-1059 exclusions to feed
  code.
```

Event-kind table additions: `1059 | NIP-59/CORD-01 | also Concord streams (see Concord section)`, `3313 | CORD-05 | Concord direct invite (rumor)`, `13302/13303 | CORD | Concord community/invite lists (self-encrypted)`, `33301 | CORD-05 | Concord invite bundle`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(concord): CLAUDE.md section for private channels"
```

---

## Deviations from the design prototype (intentional, Phase 1)

1. **Public channels stay in the existing Chat tab** — the prototype's rail merges public + private channels; the app keeps its tab structure ('channels' tab = private only). Revisit in a later phase.
2. **Per-message ghost bubbles are not implemented** — rumor stores only ever contain decrypted rumors; "undecryptable newer-epoch message" isn't observable per-message. Sync/removed states cover the corresponding UX.
3. **Roles UI is read-light** — the members modal shows the derived list without Gründer/Admin/Mitglied chips in Phase 1 (roles/grants observables exist; chips can be added cheaply later). Owner-only moderation buttons.
4. **Dissolve is community-level** (all private channels at once) — matches the package; the confirm dialog says so explicitly.
5. **New-device sync pane** ("Neues Gerät wird eingerichtet") is covered by the generic syncing state, not a separate detection.

## Post-plan checks (run once at the end)

- [ ] `pnpm test` (full suite; known flaky inbox/DM files may need isolation — see memory)
- [ ] `pnpm run check && pnpm run lint && pnpm run build`
- [ ] `pnpm run test:e2e -- concord-channels` in the nix shell
- [ ] Manual dev-server pass with `CONCORD_ENABLED=false` — zero Concord UI, zero Concord network traffic (check devtools WS connections)
