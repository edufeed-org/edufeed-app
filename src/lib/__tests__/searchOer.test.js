// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { searchOer, fetchOerAsset } from '$lib/helpers/oer/searchOer.js';

describe('searchOer', () => {
  it('builds the /api/oer query and returns the parsed payload', async () => {
    const payload = { data: [{ id: 'a' }], meta: { hasMore: true } };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => payload }));
    const out = await searchOer(
      { searchTerm: 'tree', sources: ['openverse', 'wikimedia'], page: 2, language: 'de' },
      fetchImpl
    );
    expect(out).toEqual(payload);
    const u = new URL(fetchImpl.mock.calls[0][0], 'http://localhost');
    expect(u.pathname).toBe('/api/oer');
    expect(u.searchParams.get('searchTerm')).toBe('tree');
    expect(u.searchParams.get('sources')).toBe('openverse,wikimedia');
    expect(u.searchParams.get('page')).toBe('2');
    expect(u.searchParams.get('language')).toBe('de');
  });

  it('throws when /api/oer responds non-ok', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(
      searchOer({ searchTerm: 'tree', sources: ['openverse'] }, fetchImpl)
    ).rejects.toThrow();
  });
});

describe('fetchOerAsset', () => {
  it('calls /api/oer/asset with the url and returns sha/mime/size', async () => {
    const meta = { sha256: 'abc', mime: 'image/png', size: 10 };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => meta }));
    const out = await fetchOerAsset('https://img.example/x.png', fetchImpl);
    expect(out).toEqual(meta);
    const u = new URL(fetchImpl.mock.calls[0][0], 'http://localhost');
    expect(u.pathname).toBe('/api/oer/asset');
    expect(u.searchParams.get('url')).toBe('https://img.example/x.png');
  });

  it('throws when the asset endpoint responds non-ok', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    await expect(fetchOerAsset('https://img.example/x.png', fetchImpl)).rejects.toThrow();
  });
});
