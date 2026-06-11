// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyNip05, _clearNip05Cache } from '../nip05-verify.js';

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
