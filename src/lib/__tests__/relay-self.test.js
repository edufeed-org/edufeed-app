/** @vitest-environment node */
/**
 * fetchRelaySelf — Task A6. GETs a group relay's NIP-11 document over
 * https(s) and returns its `self` pubkey (the identity that signs the
 * relay's own kind-39000 group-metadata events, per NIP-29), so an invite DM
 * can build a cross-client `nostr:naddr…` line. Module-level cache per
 * normalized URL; any failure (bad status, network error, timeout, missing
 * field) resolves to null rather than rejecting — callers just omit the
 * naddr line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchRelaySelf, __resetRelaySelfCache } = await import('$lib/groups/relay-self.js');

beforeEach(() => {
  __resetRelaySelfCache();
  vi.unstubAllGlobals();
});

describe('fetchRelaySelf', () => {
  it('GETs the NIP-11 doc over https with the right Accept header and returns self', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ self: 'a'.repeat(64) })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const self = await fetchRelaySelf('wss://relay.example/');

    expect(self).toBe('a'.repeat(64));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = /** @type {any[]} */ (fetchMock.mock.calls[0]);
    expect(url).toBe('https://relay.example/');
    expect(opts.headers.Accept).toBe('application/nostr+json');
  });

  it('caches per normalized URL: a second call for the same relay does not fetch again', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ self: 'b'.repeat(64) })
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchRelaySelf('wss://relay.example');
    await fetchRelaySelf('wss://relay.example/');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves null on a non-OK status', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRelaySelf('wss://relay-500.example/')).resolves.toBeNull();
  });

  it('resolves null when the document has no self field', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRelaySelf('wss://relay-noself.example/')).resolves.toBeNull();
  });

  it('resolves null on a network error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRelaySelf('wss://relay-err.example/')).resolves.toBeNull();
  });

  it('does NOT cache a failure: a later call for the same relay retries the fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ self: 'c'.repeat(64) }) });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchRelaySelf('wss://relay-retry.example/');
    expect(first).toBeNull();

    const second = await fetchRelaySelf('wss://relay-retry.example/');
    expect(second).toBe('c'.repeat(64));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves null when the request times out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (/** @type {string} */ _url, /** @type {{signal: AbortSignal}} */ opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchRelaySelf('wss://relay-timeout.example/');
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promise).resolves.toBeNull();
    vi.useRealTimers();
  });
});
