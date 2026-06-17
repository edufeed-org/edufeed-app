// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { fanOutOerSearch } from '$lib/server/oerFanout.js';

/** @param {string} id @param {string} [url] */
const item = (id, url = `https://img.example/${id}.jpg`) => ({ id, amb: { id: url } });

/** Build a fake fetch that maps source → response body (or throws for a source). */
function makeFetch(bySource) {
  return vi.fn(async (urlStr) => {
    const u = new URL(urlStr);
    const source = u.searchParams.get('source');
    const entry = bySource[source];
    if (entry instanceof Error) throw entry;
    if (entry?.notOk) return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => entry };
  });
}

describe('fanOutOerSearch', () => {
  const base = {
    baseUrl: 'https://oer.proxy',
    searchTerm: 'tree',
    type: 'image',
    page: 1,
    pageSize: 20
  };

  it('fans out one request per source and passes source/searchTerm/type/page', async () => {
    const fetchImpl = makeFetch({
      openverse: { data: [item('a')], meta: { hasMore: false } },
      wikimedia: { data: [item('b')], meta: { hasMore: false } }
    });
    const out = await fanOutOerSearch({ ...base, sources: ['openverse', 'wikimedia'], fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const urls = fetchImpl.mock.calls.map((c) => new URL(c[0]));
    expect(urls.map((u) => u.searchParams.get('source')).sort()).toEqual([
      'openverse',
      'wikimedia'
    ]);
    for (const u of urls) {
      expect(u.searchParams.get('searchTerm')).toBe('tree');
      expect(u.searchParams.get('type')).toBe('image');
      expect(u.searchParams.get('page')).toBe('1');
    }
    expect(out.data.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('dedupes across sources by amb.id, first occurrence wins', async () => {
    const dup = 'https://img.example/same.jpg';
    const fetchImpl = makeFetch({
      openverse: { data: [{ id: 'ov', amb: { id: dup } }], meta: {} },
      wikimedia: { data: [{ id: 'wm', amb: { id: dup } }], meta: {} }
    });
    const out = await fanOutOerSearch({ ...base, sources: ['openverse', 'wikimedia'], fetchImpl });
    expect(out.data).toHaveLength(1);
    expect(out.data[0].id).toBe('ov');
  });

  it('aggregates hasMore = true when any source reports more', async () => {
    const fetchImpl = makeFetch({
      openverse: { data: [item('a')], meta: { hasMore: false } },
      wikimedia: { data: [item('b')], meta: { hasMore: true } }
    });
    const out = await fanOutOerSearch({ ...base, sources: ['openverse', 'wikimedia'], fetchImpl });
    expect(out.meta.hasMore).toBe(true);
  });

  it('omits a failing source but still returns the others', async () => {
    const fetchImpl = makeFetch({
      openverse: new Error('network down'),
      wikimedia: { data: [item('b')], meta: { hasMore: false } }
    });
    const out = await fanOutOerSearch({ ...base, sources: ['openverse', 'wikimedia'], fetchImpl });
    expect(out.data.map((i) => i.id)).toEqual(['b']);
    expect(out.meta.hasMore).toBe(false);
  });

  it('omits a non-ok upstream response', async () => {
    const fetchImpl = makeFetch({
      openverse: { notOk: true },
      wikimedia: { data: [item('b')], meta: {} }
    });
    const out = await fanOutOerSearch({ ...base, sources: ['openverse', 'wikimedia'], fetchImpl });
    expect(out.data.map((i) => i.id)).toEqual(['b']);
  });
});
