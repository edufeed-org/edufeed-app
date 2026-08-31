/** @vitest-environment node */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { CordnStorage } from '$lib/cordn/storage.js';

describe('CordnStorage', () => {
  it('round-trips values per user namespace', async () => {
    const a = new CordnStorage('a'.repeat(64));
    const b = new CordnStorage('b'.repeat(64));
    await a.set('groups', [{ id: 'g1' }]);
    expect(await a.get('groups')).toEqual([{ id: 'g1' }]);
    expect(await b.get('groups')).toBeUndefined();
    await a.delete('groups');
    expect(await a.get('groups')).toBeUndefined();
    await a.close();
    await b.close();
  });

  it('persists structured records with binary-friendly fields', async () => {
    const storage = new CordnStorage('c'.repeat(64));
    const record = {
      stateBase64: 'AAEC',
      fetchCursor: 3,
      messages: [{ cursor: 1, content: 'hi' }]
    };
    await storage.set('group:g1', record);
    expect(await storage.get('group:g1')).toEqual(record);
    await storage.close();
  });
});
