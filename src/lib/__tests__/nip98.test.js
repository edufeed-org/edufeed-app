// @ts-nocheck
/**
 * NIP-98 auth helper tests
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { createNIP98AuthHeader } from '$lib/helpers/nip98.js';

describe('createNIP98AuthHeader', () => {
  const mockSigner = vi.fn(async (draft) => ({
    ...draft,
    id: 'signed-event-id',
    sig: 'fake-sig-hex',
    pubkey: 'test-pubkey'
  }));

  it('creates a Nostr base64 header string', async () => {
    const header = await createNIP98AuthHeader(
      'https://operator.example.com/token',
      'POST',
      '{"test": true}',
      mockSigner
    );

    expect(header).toMatch(/^Nostr /);
    const base64 = header.slice(6);
    const decoded = JSON.parse(atob(base64));
    expect(decoded.kind).toBe(27235);
  });

  it('includes correct u, method tags', async () => {
    const header = await createNIP98AuthHeader('https://example.com/api', 'POST', null, mockSigner);

    const decoded = JSON.parse(atob(header.slice(6)));
    const uTag = decoded.tags.find((/** @type {string[]} */ t) => t[0] === 'u');
    const methodTag = decoded.tags.find((/** @type {string[]} */ t) => t[0] === 'method');

    expect(uTag[1]).toBe('https://example.com/api');
    expect(methodTag[1]).toBe('POST');
  });

  it('includes payload hash when body is provided', async () => {
    const body = '{"room":"30312:abc:test"}';
    const header = await createNIP98AuthHeader('https://example.com/api', 'POST', body, mockSigner);

    const decoded = JSON.parse(atob(header.slice(6)));
    const payloadTag = decoded.tags.find((/** @type {string[]} */ t) => t[0] === 'payload');

    expect(payloadTag).toBeDefined();
    expect(payloadTag[1]).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('omits payload tag when no body', async () => {
    const header = await createNIP98AuthHeader('https://example.com/api', 'GET', null, mockSigner);

    const decoded = JSON.parse(atob(header.slice(6)));
    const payloadTag = decoded.tags.find((/** @type {string[]} */ t) => t[0] === 'payload');

    expect(payloadTag).toBeUndefined();
  });

  it('calls signer with the draft event', async () => {
    await createNIP98AuthHeader('https://example.com/api', 'POST', null, mockSigner);

    expect(mockSigner).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 27235,
        created_at: expect.any(Number),
        content: '',
        tags: expect.any(Array)
      })
    );
  });
});
