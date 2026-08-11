/** @vitest-environment jsdom */
// Authenticated media from a group host. Measured on
// edufeed.communities.buzz.xyz: /media/<sha>.<ext> answers 401 anonymously,
// 403 "relay membership required" with a VALID Blossom kind-24242 auth from a
// non-member — so a member's signed fetch is what Armada does, and what we do.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isSameMediaHost,
  fetchAuthedMediaUrl,
  __resetAuthedMediaCache
} from '$lib/groups/authed-media.js';

const RELAY = 'wss://edufeed.communities.buzz.xyz/';
const URL_OK = 'https://edufeed.communities.buzz.xyz/media/' + 'a'.repeat(64) + '.png';

const user = {
  pubkey: 'f'.repeat(64),
  signer: {
    signEvent: vi.fn(async (t) => ({ ...t, id: 'i'.repeat(64), sig: 's'.repeat(128) }))
  }
};

beforeEach(() => {
  __resetAuthedMediaCache();
  user.signer.signEvent.mockClear();
  vi.unstubAllGlobals();
  if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => '';
  vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:authed');
});

describe('isSameMediaHost', () => {
  it('matches the relay hostname across schemes', () => {
    expect(isSameMediaHost(URL_OK, RELAY)).toBe(true);
    expect(isSameMediaHost('https://image.nostr.build/x.png', RELAY)).toBe(false);
    expect(isSameMediaHost('not a url', RELAY)).toBe(false);
    expect(isSameMediaHost(URL_OK, null)).toBe(false);
  });
});

describe('fetchAuthedMediaUrl', () => {
  it('signs a kind-24242 get auth carrying the blob sha and fetches with it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchMock);

    const url = await fetchAuthedMediaUrl(URL_OK, user);
    expect(url).toBe('blob:authed');

    const signed = user.signer.signEvent.mock.calls[0][0];
    expect(signed.kind).toBe(24242);
    expect(signed.content).toBe('get');
    expect(signed.tags).toContainEqual(['t', 'get']);
    expect(signed.tags).toContainEqual(['x', 'a'.repeat(64)]);
    expect(signed.tags.some((/** @type {string[]} */ t) => t[0] === 'expiration')).toBe(true);

    const [calledUrl, opts] = /** @type {any[]} */ (fetchMock.mock.calls[0]);
    expect(calledUrl).toBe(URL_OK);
    expect(opts.headers.Authorization).toMatch(/^Nostr /);
  });

  it('caches per URL — one sign, one fetch for repeat callers', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([fetchAuthedMediaUrl(URL_OK, user), fetchAuthedMediaUrl(URL_OK, user)]);
    await fetchAuthedMediaUrl(URL_OK, user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(user.signer.signEvent).toHaveBeenCalledTimes(1);
  });

  it('resolves null on a refusal, without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403 }))
    );
    expect(await fetchAuthedMediaUrl(URL_OK, user)).toBe(null);
  });

  it('resolves null with no signer', async () => {
    expect(await fetchAuthedMediaUrl(URL_OK, null)).toBe(null);
  });
});
