/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import { resolveMetadataInput } from '$lib/helpers/educational/resolveMetadataInput.js';

const OWNER = '11'.repeat(32); // 64 hex chars
const STRANGER = '22'.repeat(32);

/**
 * @param {string} pubkey
 * @param {number} kind
 * @param {string} [identifier]
 */
function makeNaddr(pubkey, kind, identifier = 'my-resource') {
  return nip19.naddrEncode({ pubkey, kind, identifier, relays: [] });
}

describe('resolveMetadataInput', () => {
  it('returns {kind: "empty"} for blank input', async () => {
    const result = await resolveMetadataInput('', { activeUserPubkey: OWNER, fetchFn: vi.fn() });
    expect(result).toEqual({ kind: 'empty' });
  });

  it('returns {kind: "invalid"} for non-URL non-naddr input', async () => {
    const result = await resolveMetadataInput('just some text', {
      activeUserPubkey: OWNER,
      fetchFn: vi.fn()
    });
    expect(result.kind).toBe('invalid');
  });

  it('fetches metadata for a valid http URL', async () => {
    const mockResponse = {
      success: true,
      metadata: { source: 'amb-jsonld', amb: { id: 'x', name: 'hi' } }
    };
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const result = await resolveMetadataInput('https://example.org/lesson/42', {
      activeUserPubkey: OWNER,
      fetchFn
    });

    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/api/reader?mode=metadata&url='));
    expect(result).toEqual({
      kind: 'url',
      url: 'https://example.org/lesson/42',
      metadata: mockResponse.metadata
    });
  });

  it('returns {kind: "url", metadata: {source: "none"}} when fetch succeeds but finds nothing', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, metadata: { source: 'none' } })
    });
    const result = await resolveMetadataInput('https://example.org/bare', {
      activeUserPubkey: OWNER,
      fetchFn
    });
    expect(result.kind).toBe('url');
    expect(/** @type {any} */ (result).metadata.source).toBe('none');
  });

  it('returns {kind: "url", metadata: {source: "none"}} when fetch errors (non-blocking)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await resolveMetadataInput('https://example.org/bare', {
      activeUserPubkey: OWNER,
      fetchFn
    });
    expect(result.kind).toBe('url');
    expect(/** @type {any} */ (result).metadata.source).toBe('none');
  });

  it('returns {kind: "naddr-edit"} when naddr is a 30142 owned by current user', async () => {
    const naddr = makeNaddr(OWNER, 30142);
    const result = await resolveMetadataInput(naddr, {
      activeUserPubkey: OWNER,
      fetchFn: vi.fn()
    });
    expect(result).toEqual({ kind: 'naddr-edit', naddrString: naddr });
  });

  it('returns {kind: "naddr-not-owned"} when naddr is a 30142 not owned by current user', async () => {
    const naddr = makeNaddr(STRANGER, 30142);
    const result = await resolveMetadataInput(naddr, {
      activeUserPubkey: OWNER,
      fetchFn: vi.fn()
    });
    expect(result.kind).toBe('naddr-not-owned');
  });

  it('returns {kind: "naddr-wrong-kind"} when naddr is not a 30142', async () => {
    const naddr = makeNaddr(OWNER, 30023); // long-form article
    const result = await resolveMetadataInput(naddr, {
      activeUserPubkey: OWNER,
      fetchFn: vi.fn()
    });
    expect(result.kind).toBe('naddr-wrong-kind');
  });

  it('rejects http(s) URLs to private/local hosts as invalid', async () => {
    const result = await resolveMetadataInput('http://localhost/x', {
      activeUserPubkey: OWNER,
      fetchFn: vi.fn()
    });
    expect(result.kind).toBe('invalid');
  });
});
