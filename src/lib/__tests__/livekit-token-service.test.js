/**
 * LiveKit Token Service Tests
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/helpers/nip98.js', () => ({
  createNIP98AuthHeader: vi.fn(async () => 'Nostr fake-auth-header')
}));

import { requestLiveKitToken } from '$lib/services/livekit-token-service.js';
import { createNIP98AuthHeader } from '$lib/helpers/nip98.js';

const mockSigner = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  // Re-mock createNIP98AuthHeader after restoreAllMocks
  vi.mocked(createNIP98AuthHeader).mockResolvedValue('Nostr fake-auth-header');
});

describe('requestLiveKitToken', () => {
  it('sends request to /api/meet/token proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: 'tok', url: 'wss://lk' })
      }))
    );

    await requestLiveKitToken('https://op.example.com/', 'room-coord', 'community-pk', mockSigner);

    expect(fetch).toHaveBeenCalledWith('/api/meet/token', expect.any(Object));
  });

  it('sends POST with operatorUrl, room, community in body and auth header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: 'tok', url: 'wss://lk' })
      }))
    );

    await requestLiveKitToken(
      'https://op.example.com',
      '30312:abc:test',
      'community-pk',
      mockSigner
    );

    expect(fetch).toHaveBeenCalledWith(
      '/api/meet/token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Nostr fake-auth-header'
        },
        body: JSON.stringify({
          operatorUrl: 'https://op.example.com',
          room: '30312:abc:test',
          community: 'community-pk'
        })
      })
    );
  });

  it('signs NIP-98 against the operator URL, not the proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: 'tok', url: 'wss://lk' })
      }))
    );

    await requestLiveKitToken(
      'https://op.example.com',
      '30312:abc:test',
      'community-pk',
      mockSigner
    );

    expect(createNIP98AuthHeader).toHaveBeenCalledWith(
      'https://op.example.com/token',
      'POST',
      JSON.stringify({ room: '30312:abc:test', community: 'community-pk' }),
      mockSigner
    );
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: 'tok', url: 'wss://lk' })
      }))
    );

    const result = await requestLiveKitToken(
      'https://op.example.com',
      'room-coord',
      'community-pk',
      mockSigner
    );

    expect(result).toEqual({ token: 'tok', url: 'wss://lk' });
  });

  it('throws with status and body on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => 'Forbidden'
      }))
    );

    await expect(
      requestLiveKitToken('https://op.example.com', 'room-coord', 'community-pk', mockSigner)
    ).rejects.toThrow(/Token request failed \(403\)/);
  });

  it('throws when proxy returns 502 for missing token/url in operator response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => JSON.stringify({ error: 'Operator response missing required fields' })
      }))
    );

    await expect(
      requestLiveKitToken('https://op.example.com', 'room-coord', 'community-pk', mockSigner)
    ).rejects.toThrow(/Token request failed \(502\)/);
  });
});
