/**
 * getSearchExtensions(relay) — which NIP-50 search-string extensions a relay
 * advertises in its NIP-11 document (`limitation.search_extensions`, as the
 * Brainstorm tags relay does: observer / sort / filter). Anything else —
 * no document, timeout, malformed JSON — means "none", so a plain relay
 * never receives tokens it would treat as search words.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

/** @param {any} body */
function okJson(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe('getSearchExtensions', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
  });

  it('returns the advertised extensions and fetches NIP-11 over https with the nostr+json accept header', async () => {
    fetchMock.mockReturnValue(
      okJson({ supported_nips: [50], limitation: { search_extensions: ['observer', 'sort'] } })
    );
    const { getSearchExtensions } = await import('$lib/helpers/relay-search-extensions.js');
    await expect(getSearchExtensions('wss://tags.example/relay')).resolves.toEqual([
      'observer',
      'sort'
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://tags.example/relay',
      expect.objectContaining({ headers: { Accept: 'application/nostr+json' } })
    );
  });

  it('caches per relay — one document fetch for many lookups', async () => {
    fetchMock.mockReturnValue(okJson({ limitation: { search_extensions: ['observer'] } }));
    const { getSearchExtensions } = await import('$lib/helpers/relay-search-extensions.js');
    await getSearchExtensions('wss://tags.example/relay');
    await getSearchExtensions('wss://tags.example/relay/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns [] for a relay without the field, a failed fetch, or a non-array value', async () => {
    const { getSearchExtensions } = await import('$lib/helpers/relay-search-extensions.js');
    fetchMock.mockReturnValueOnce(okJson({ supported_nips: [1, 50] }));
    await expect(getSearchExtensions('wss://plain.example')).resolves.toEqual([]);
    fetchMock.mockReturnValueOnce(Promise.reject(new Error('boom')));
    await expect(getSearchExtensions('wss://down.example')).resolves.toEqual([]);
    fetchMock.mockReturnValueOnce(okJson({ limitation: { search_extensions: 'observer' } }));
    await expect(getSearchExtensions('wss://odd.example')).resolves.toEqual([]);
  });

  it('does not cache a failure, so a relay that was briefly down is re-probed', async () => {
    const { getSearchExtensions } = await import('$lib/helpers/relay-search-extensions.js');
    fetchMock.mockReturnValueOnce(Promise.reject(new Error('offline')));
    await expect(getSearchExtensions('wss://flaky.example')).resolves.toEqual([]);
    fetchMock.mockReturnValueOnce(okJson({ limitation: { search_extensions: ['observer'] } }));
    await expect(getSearchExtensions('wss://flaky.example')).resolves.toEqual(['observer']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
