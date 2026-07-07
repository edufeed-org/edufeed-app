// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  verifyNip05,
  getProfileNip05s,
  aggregateNip05Results,
  _clearNip05Cache
} from '../nip05-verify.js';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('verifyNip05', () => {
  beforeEach(() => {
    _clearNip05Cache();
  });

  it('returns "verified" when names[name] matches the expected pubkey', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: { alice: ALICE } }));
    const result = await verifyNip05('alice@edufeed.org', ALICE, fetchMock);
    expect(result).toBe('verified');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://edufeed.org/.well-known/nostr.json?name=alice',
      expect.any(Object)
    );
  });

  it('returns "mismatch" when names[name] points to a different pubkey', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: { alice: BOB } }));
    expect(await verifyNip05('alice@edufeed.org', ALICE, fetchMock)).toBe('mismatch');
  });

  it('returns "mismatch" when the name is missing entirely from names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: {} }));
    expect(await verifyNip05('alice@edufeed.org', ALICE, fetchMock)).toBe('mismatch');
  });

  it('handles the bare "_@domain" shorthand by querying name=_', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: { _: ALICE } }));
    const result = await verifyNip05('_@edufeed.org', ALICE, fetchMock);
    expect(result).toBe('verified');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://edufeed.org/.well-known/nostr.json?name=_',
      expect.any(Object)
    );
  });

  it('treats a bare domain (no @) as "_@domain"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: { _: ALICE } }));
    const result = await verifyNip05('edufeed.org', ALICE, fetchMock);
    expect(result).toBe('verified');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://edufeed.org/.well-known/nostr.json?name=_',
      expect.any(Object)
    );
  });

  it('returns "error" when the address is malformed', async () => {
    const fetchMock = vi.fn();
    expect(await verifyNip05('', ALICE, fetchMock)).toBe('error');
    expect(await verifyNip05('not a real address', ALICE, fetchMock)).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns "error" when fetch rejects (network/CORS)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await verifyNip05('alice@edufeed.org', ALICE, fetchMock)).toBe('error');
  });

  it('returns "error" when upstream responds non-OK', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    expect(await verifyNip05('alice@edufeed.org', ALICE, fetchMock)).toBe('error');
  });

  it('returns "error" when upstream body is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    expect(await verifyNip05('alice@edufeed.org', ALICE, fetchMock)).toBe('error');
  });

  it('caches successful verifications and does not refetch the same (nip05, pubkey) pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: { alice: ALICE } }));
    await verifyNip05('alice@edufeed.org', ALICE, fetchMock);
    await verifyNip05('alice@edufeed.org', ALICE, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches "mismatch" too (a wrong mapping is still authoritative for this pair)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: { alice: BOB } }));
    await verifyNip05('alice@edufeed.org', ALICE, fetchMock);
    await verifyNip05('alice@edufeed.org', ALICE, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache "error" results (so transient network failures can recover)', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ names: { alice: ALICE } }));
    expect(await verifyNip05('alice@edufeed.org', ALICE, fetchMock)).toBe('error');
    expect(await verifyNip05('alice@edufeed.org', ALICE, fetchMock)).toBe('verified');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the same cache key regardless of nip05 case (names are case-insensitive in practice)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ names: { alice: ALICE } }));
    await verifyNip05('Alice@Edufeed.org', ALICE, fetchMock);
    await verifyNip05('alice@edufeed.org', ALICE, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getProfileNip05s', () => {
  /** Build a kind-0 event with the given content object and tags. */
  function kind0(content, tags = []) {
    return {
      kind: 0,
      pubkey: 'a'.repeat(64),
      content: typeof content === 'string' ? content : JSON.stringify(content),
      tags,
      created_at: 0,
      id: 'x',
      sig: ''
    };
  }

  it('returns the content nip05 as a single entry', () => {
    const event = kind0({ nip05: 'alice@edufeed.org' });
    expect(getProfileNip05s(event)).toEqual(['alice@edufeed.org']);
  });

  it('appends nip05 event tags after the content nip05 (Laeserin-style profiles)', () => {
    const event = kind0({ nip05: 'laeserin@gitcitadel.com' }, [
      ['nip05', 'laeserin@theforest.nostr1.com'],
      ['nip05', 'laeserin@sovbit.host'],
      ['website', 'https://example.org']
    ]);
    expect(getProfileNip05s(event)).toEqual([
      'laeserin@gitcitadel.com',
      'laeserin@theforest.nostr1.com',
      'laeserin@sovbit.host'
    ]);
  });

  it('dedupes case-insensitively between content and tags', () => {
    const event = kind0({ nip05: 'Alice@Edufeed.org' }, [
      ['nip05', 'alice@edufeed.org'],
      ['nip05', 'alice@other.org']
    ]);
    expect(getProfileNip05s(event)).toEqual(['Alice@Edufeed.org', 'alice@other.org']);
  });

  it('works with only tags and no content nip05', () => {
    const event = kind0({ name: 'Alice' }, [['nip05', 'alice@edufeed.org']]);
    expect(getProfileNip05s(event)).toEqual(['alice@edufeed.org']);
  });

  it('tolerates malformed content, empty tag values and missing event', () => {
    expect(getProfileNip05s(null)).toEqual([]);
    expect(getProfileNip05s(undefined)).toEqual([]);
    expect(getProfileNip05s(kind0('not json', [['nip05', ' alice@edufeed.org ']]))).toEqual([
      'alice@edufeed.org'
    ]);
    expect(getProfileNip05s(kind0({ nip05: 42 }, [['nip05'], ['nip05', '']]))).toEqual([]);
  });
});

describe('aggregateNip05Results', () => {
  it('is verified when any address verifies', () => {
    expect(aggregateNip05Results(['mismatch', 'verified'])).toBe('verified');
    expect(aggregateNip05Results(['verified'])).toBe('verified');
  });

  it('is pending while any address is still resolving and none verified yet', () => {
    expect(aggregateNip05Results(['pending', 'mismatch'])).toBe('pending');
    expect(aggregateNip05Results(['pending'])).toBe('pending');
  });

  it('short-circuits to verified even with pending siblings', () => {
    expect(aggregateNip05Results(['pending', 'verified'])).toBe('verified');
  });

  it('is unverified when all addresses failed to verify', () => {
    expect(aggregateNip05Results(['mismatch', 'error'])).toBe('unverified');
  });

  it('is unverified for a profile without any address', () => {
    expect(aggregateNip05Results([])).toBe('unverified');
  });
});
