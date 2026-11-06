/** @vitest-environment node */
// The Termi chat request is NIP-98 signed over the exact body string the
// server receives — /api/termi/chat hashes the raw body (verifyNip98Header).
import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { buildSignedChatRequest } from '$lib/components/assistant/termi-chat-request.js';
import { verifyNip98Header } from '$lib/server/nip98-verify.js';

const URL_ = 'https://edufeed.example/api/termi/chat';

function testUser() {
  const sk = generateSecretKey();
  return {
    pubkey: getPublicKey(sk),
    signer: { signEvent: async (/** @type {any} */ draft) => finalizeEvent(draft, sk) }
  };
}

describe('buildSignedChatRequest', () => {
  it('signs the body string it returns', async () => {
    const user = testUser();
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Bruchrechnung' }] }];
    const req = await buildSignedChatRequest({
      body: { task: 'search', messages },
      user,
      url: URL_
    });
    expect(req.body).toBe(JSON.stringify({ task: 'search', messages }));
    expect(await verifyNip98Header(req.headers.Authorization, URL_, 'POST', req.body)).toBe(
      user.pubkey
    );
    // A different body does not pass with the same header.
    expect(
      await verifyNip98Header(req.headers.Authorization, URL_, 'POST', req.body + ' ')
    ).toBeNull();
  });

  it('rejects when the signer rejects', async () => {
    const user = {
      pubkey: 'a'.repeat(64),
      signer: { signEvent: async () => Promise.reject(new Error('denied')) }
    };
    await expect(
      buildSignedChatRequest({ body: { task: 'search', messages: [] }, user, url: URL_ })
    ).rejects.toThrow('denied');
  });
});
