/**
 * Termi assistant chat: an @ai-sdk/svelte Chat against /api/termi/chat, in
 * memory only. Reached through a dynamic import from TermiChatWindow, so `ai`
 * never enters the root layout's static graph.
 */
import { Chat } from '@ai-sdk/svelte';
import { DefaultChatTransport } from 'ai';
import { buildSignedChatRequest } from './termi-chat-request.js';

/** A non-stream answer the window handles itself (429 quota/rate, 503 off). */
export class TermiChatHttpError extends Error {
  /** @param {number} status @param {string} [scope] 429 quota: 'user' | 'global' */
  constructor(status, scope) {
    super(`termi chat ${status}`);
    this.name = 'TermiChatHttpError';
    this.status = status;
    this.scope = scope;
  }
}

/**
 * @param {{
 *   task: 'search',
 *   user: { pubkey: string, signer: { signEvent: (draft: any) => Promise<any> } },
 *   fetch?: typeof fetch
 * }} opts
 */
export function createTermiChat({
  task,
  user,
  fetch: fetchImpl = (...a) => globalThis.fetch(...a)
}) {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once, never mutated
  const url = new URL('/api/termi/chat', location.origin).href;
  const transport = new DefaultChatTransport({
    api: '/api/termi/chat',
    // A string body on purpose (typed `object`): see `fetch` below.
    prepareSendMessagesRequest: ({ messages }) =>
      /** @type {Promise<any>} */ (buildSignedChatRequest({ body: { task, messages }, user, url })),
    // The transport JSON.stringifies the prepared body; unwrap it so the
    // signed string goes out byte for byte.
    fetch: async (input, init) => {
      const res = await fetchImpl(input, { ...init, body: JSON.parse(String(init?.body)) });
      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        throw new TermiChatHttpError(429, body?.scope);
      }
      if (res.status === 503) throw new TermiChatHttpError(503);
      return res;
    }
  });
  const chat = new Chat({ transport });
  return {
    chat,
    reset() {
      chat.stop();
      chat.messages = [];
      chat.clearError();
    }
  };
}
