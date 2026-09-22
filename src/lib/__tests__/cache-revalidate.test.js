/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createRevalidatingCacheRequest } from '$lib/helpers/cache-revalidate.js';

const PUBKEY = 'p'.repeat(64);

/**
 * @param {Partial<import('nostr-tools').Event>} over
 * @returns {import('nostr-tools').Event}
 */
const ev = (over = {}) => ({
  id: 'a'.repeat(64),
  kind: 0,
  pubkey: PUBKEY,
  created_at: 1000,
  tags: [],
  content: '',
  sig: 's'.repeat(128),
  ...over
});

describe('createRevalidatingCacheRequest', () => {
  it('returns the inner cache result unchanged', async () => {
    const cached = [ev()];
    const inner = vi.fn(async () => cached);
    const revalidate = vi.fn();
    const request = createRevalidatingCacheRequest(inner, revalidate);

    const result = await request([{ kinds: [0], authors: [PUBKEY] }]);

    expect(inner).toHaveBeenCalledWith([{ kinds: [0], authors: [PUBKEY] }]);
    expect(result).toBe(cached);
  });

  it('revalidates replaceable events served from the cache, without an identifier', async () => {
    const revalidate = vi.fn();
    const request = createRevalidatingCacheRequest(async () => [ev()], revalidate);

    await request([{ kinds: [0] }]);

    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith([{ kind: 0, pubkey: PUBKEY }]);
  });

  it('passes the d-tag identifier for addressable events', async () => {
    const revalidate = vi.fn();
    const resource = ev({ id: 'b'.repeat(64), kind: 30142, tags: [['d', 'res-1']] });
    const request = createRevalidatingCacheRequest(async () => [resource], revalidate);

    await request([{ kinds: [30142] }]);

    expect(revalidate).toHaveBeenCalledWith([{ kind: 30142, pubkey: PUBKEY, identifier: 'res-1' }]);
  });

  it('groups every cached pointer of one request into a single revalidate call', async () => {
    const revalidate = vi.fn();
    const other = ev({ id: 'c'.repeat(64), pubkey: 'q'.repeat(64) });
    const request = createRevalidatingCacheRequest(async () => [ev(), other], revalidate);

    await request([{ kinds: [0] }]);

    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate.mock.calls[0][0]).toHaveLength(2);
  });

  it('revalidates each address at most once per session', async () => {
    const revalidate = vi.fn();
    const request = createRevalidatingCacheRequest(async () => [ev()], revalidate);

    await request([{ kinds: [0] }]);
    await request([{ kinds: [0] }]);

    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it('ignores regular events and empty results', async () => {
    const revalidate = vi.fn();
    const note = ev({ id: 'd'.repeat(64), kind: 1 });
    const request = createRevalidatingCacheRequest(async () => [note], revalidate);
    await request([{ kinds: [1] }]);

    const empty = createRevalidatingCacheRequest(async () => [], revalidate);
    await empty([{ kinds: [0] }]);

    expect(revalidate).not.toHaveBeenCalled();
  });

  it('still returns the cached events when revalidate throws', async () => {
    const cached = [ev()];
    const request = createRevalidatingCacheRequest(
      async () => cached,
      () => {
        throw new Error('boom');
      }
    );

    await expect(request([{ kinds: [0] }])).resolves.toBe(cached);
  });
});
