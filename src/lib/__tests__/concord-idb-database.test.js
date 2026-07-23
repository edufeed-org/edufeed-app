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
