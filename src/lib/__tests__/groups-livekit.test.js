/** @vitest-environment node */
/**
 * NIP-29 live audio/video transport (spec section "Live audio/video (AV)
 * spaces"): the relay marks an AV group with a bare `livekit` tag on its
 * kind-39000, advertises support with a 204 on
 * `/.well-known/nip29/livekit`, and mints LiveKit tokens at
 * `/.well-known/nip29/livekit/<group-id>` for a NIP-98 (kind 27235) GET whose
 * `u` tag equals that exact URL. Token identities start with the user's
 * 64-hex pubkey followed by a random suffix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  relayHttpOrigin,
  livekitProbeUrl,
  livekitTokenUrl,
  hasLivekitTag,
  identityToPubkey,
  probeRelayAvSupport,
  requestGroupCallToken,
  GroupCallTokenError,
  __resetAvProbeCache
} = await import('$lib/groups/livekit.js');

const HEX = 'a'.repeat(64);

beforeEach(() => {
  __resetAvProbeCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('relayHttpOrigin', () => {
  it('maps wss:// to https:// and keeps only the origin', () => {
    expect(relayHttpOrigin('wss://groups.edufeed.org')).toBe('https://groups.edufeed.org');
  });
  it('strips a community endpoint path (/c/<rootId>) — the .well-known lives at the origin', () => {
    expect(relayHttpOrigin('wss://groups.edufeed.org/c/abc123/')).toBe(
      'https://groups.edufeed.org'
    );
  });
  it('maps ws:// to http:// and keeps a non-default port', () => {
    expect(relayHttpOrigin('ws://localhost:3334/')).toBe('http://localhost:3334');
  });
  it('lowercases the host', () => {
    expect(relayHttpOrigin('wss://Groups.Edufeed.ORG')).toBe('https://groups.edufeed.org');
  });
  it('returns null on garbage', () => {
    expect(relayHttpOrigin('not a url')).toBeNull();
    expect(relayHttpOrigin('')).toBeNull();
  });
});

describe('URL builders', () => {
  it('probe URL is <origin>/.well-known/nip29/livekit', () => {
    expect(livekitProbeUrl('wss://groups.edufeed.org/c/x')).toBe(
      'https://groups.edufeed.org/.well-known/nip29/livekit'
    );
  });
  it('token URL appends the group id', () => {
    expect(livekitTokenUrl('wss://groups.edufeed.org', 'deadbeef')).toBe(
      'https://groups.edufeed.org/.well-known/nip29/livekit/deadbeef'
    );
  });
  it('token URL encodes an odd group id', () => {
    expect(livekitTokenUrl('wss://relay.example', 'a b/c')).toBe(
      'https://relay.example/.well-known/nip29/livekit/a%20b%2Fc'
    );
  });
});

describe('hasLivekitTag', () => {
  it('true for a bare ["livekit"] tag on the raw 39000', () => {
    expect(hasLivekitTag({ kind: 39000, tags: [['d', 'g'], ['livekit']] })).toBe(true);
  });
  it('false without the tag, for null, and for a tag with a value in another slot', () => {
    expect(hasLivekitTag({ kind: 39000, tags: [['d', 'g'], ['public']] })).toBe(false);
    expect(hasLivekitTag(null)).toBe(false);
    expect(hasLivekitTag({ kind: 39000, tags: [['name', 'livekit']] })).toBe(false);
  });
});

describe('identityToPubkey', () => {
  it('takes the first 64 hex chars of "<hex>:<suffix>"', () => {
    expect(identityToPubkey(`${HEX}:x1`)).toBe(HEX);
  });
  it('accepts a bare 64-hex identity and lowercases it', () => {
    expect(identityToPubkey(HEX.toUpperCase())).toBe(HEX);
  });
  it('returns null for short, non-hex or empty identities', () => {
    expect(identityToPubkey('abc')).toBeNull();
    expect(identityToPubkey('g'.repeat(64))).toBeNull();
    expect(identityToPubkey('')).toBeNull();
    expect(identityToPubkey(undefined)).toBeNull();
  });
});

describe('probeRelayAvSupport', () => {
  it('resolves true on 204 and caches per origin', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeRelayAvSupport('wss://groups.edufeed.org/c/root1')).resolves.toBe(true);
    await expect(probeRelayAvSupport('wss://groups.edufeed.org/')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://groups.edufeed.org/.well-known/nip29/livekit');
  });
  it('resolves false on 404 and does NOT cache the failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({ status: 204, ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeRelayAvSupport('wss://relay.example')).resolves.toBe(false);
    await expect(probeRelayAvSupport('wss://relay.example')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('resolves false when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      })
    );
    await expect(probeRelayAvSupport('wss://relay.example')).resolves.toBe(false);
  });
  it('resolves false for an unparseable relay url without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeRelayAvSupport('nope')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('dedupes in-flight probes for the same origin', async () => {
    let resolve;
    const fetchMock = vi.fn(() => new Promise((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);
    const a = probeRelayAvSupport('wss://relay.example');
    const b = probeRelayAvSupport('wss://relay.example/');
    resolve({ status: 204, ok: true });
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('requestGroupCallToken', () => {
  const user = {
    pubkey: HEX,
    signer: { signEvent: vi.fn(async (draft) => ({ ...draft, id: 'id', sig: 'sig' })) }
  };

  it('GETs the token URL with a NIP-98 header bound to that exact URL and maps the response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ server_url: 'wss://livekit.example', participant_token: 'jwt' })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestGroupCallToken('wss://groups.edufeed.org/c/root', 'g1', user);

    expect(result).toEqual({ serverUrl: 'wss://livekit.example', participantToken: 'jwt' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://groups.edufeed.org/.well-known/nip29/livekit/g1');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toMatch(/^Nostr /);
    const signed = JSON.parse(atob(opts.headers.Authorization.slice('Nostr '.length)));
    expect(signed.kind).toBe(27235);
    expect(signed.pubkey).toBe(HEX);
    expect(signed.tags).toContainEqual([
      'u',
      'https://groups.edufeed.org/.well-known/nip29/livekit/g1'
    ]);
    expect(signed.tags).toContainEqual(['method', 'GET']);
    expect(signed.tags.some((t) => t[0] === 'payload')).toBe(false);
  });

  it.each([
    [401, 'nope', 'unauthorized'],
    [403, 'livekit not enabled for this group', 'not-enabled'],
    [403, 'not allowed to access livekit for this group', 'forbidden'],
    [500, 'boom', 'server']
  ])('maps status %s (%s) to reason %s', async (status, body, reason) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status, text: async () => body, json: async () => ({}) }))
    );
    const err = await requestGroupCallToken('wss://relay.example', 'g', user).catch((e) => e);
    expect(err).toBeInstanceOf(GroupCallTokenError);
    expect(err.status).toBe(status);
    expect(err.reason).toBe(reason);
    expect(err.message).toContain(body);
  });

  it('maps a network failure to reason network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    const err = await requestGroupCallToken('wss://relay.example', 'g', user).catch((e) => e);
    expect(err).toBeInstanceOf(GroupCallTokenError);
    expect(err.reason).toBe('network');
  });

  it('maps a 200 with missing fields to reason server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    );
    const err = await requestGroupCallToken('wss://relay.example', 'g', user).catch((e) => e);
    expect(err).toBeInstanceOf(GroupCallTokenError);
    expect(err.reason).toBe('server');
  });

  it('rejects with reason network for an unparseable relay url without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await requestGroupCallToken('nope', 'g', user).catch((e) => e);
    expect(err.reason).toBe('network');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
