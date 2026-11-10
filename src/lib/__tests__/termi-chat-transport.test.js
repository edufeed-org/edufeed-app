/** @vitest-environment node */
// The Termi chat request is NIP-98 signed over the exact body string the
// server receives — /api/termi/chat hashes the raw body (verifyNip98Header).
import { describe, it, expect, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { buildSignedChatRequest } from '$lib/components/assistant/termi-chat-request.js';
import { createTermiChat } from '$lib/components/assistant/termi-chat.svelte.js';
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

describe('createTermiChat', () => {
  it('body carries task and getBodyExtras() after tz', async () => {
    vi.stubGlobal('location', { origin: 'https://edufeed.example' });
    /** @type {any[]} */
    const bodies = [];
    const fetch = /** @type {any} */ (
      vi.fn(async (_input, /** @type {any} */ init) => {
        bodies.push(init.body);
        return new Response('', { status: 503 });
      })
    );
    const { chat } = createTermiChat({
      task: 'lesson',
      user: testUser(),
      fetch,
      getBodyExtras: () => ({ locale: 'de', lesson: { phase: 2 } })
    });
    await chat.sendMessage({ text: 'Unterrichtsreihe Brüche' });
    vi.unstubAllGlobals();
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0]);
    expect(Object.keys(body)).toEqual(['task', 'messages', 'today', 'tz', 'locale', 'lesson']);
    expect(body).toMatchObject({ task: 'lesson', locale: 'de', lesson: { phase: 2 } });
  });

  it('no getBodyExtras: the plain ask body', async () => {
    vi.stubGlobal('location', { origin: 'https://edufeed.example' });
    /** @type {any[]} */
    const bodies = [];
    const fetch = /** @type {any} */ (
      vi.fn(async (_input, /** @type {any} */ init) => {
        bodies.push(init.body);
        return new Response('', { status: 503 });
      })
    );
    const { chat } = createTermiChat({ task: 'ask', user: testUser(), fetch });
    await chat.sendMessage({ text: 'Brüche' });
    vi.unstubAllGlobals();
    expect(Object.keys(JSON.parse(bodies[0]))).toEqual(['task', 'messages', 'today', 'tz']);
  });
});
