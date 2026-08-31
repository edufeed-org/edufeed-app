/** @vitest-environment node */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
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
      expect(typeof (/** @type {any} */ (store)[method]), method).toBe('function');
    }
    const e = {
      id: 'a'.repeat(64),
      kind: 9,
      created_at: 100,
      tags: [],
      content: 'hi',
      pubkey: 'f'.repeat(64)
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
    const e = { kind: 9, created_at: 101, tags: [], content: 'persist', pubkey: 'f'.repeat(64) };
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
