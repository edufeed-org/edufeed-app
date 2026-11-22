/**
 * The signed POST to /api/termi/extract — the only place a dropped file's text
 * leaves the browser, and only when the user sends the attachment chip.
 */
import { buildSignedChatRequest } from '../termi-chat-request.js';
import { TermiChatHttpError } from '../termi-chat.svelte.js';

/**
 * @param {{
 *   text: string, filename: string, locale: 'de' | 'en', today: string, tz: string,
 *   instruction?: string,
 *   user: { pubkey: string, signer: { signEvent: (draft: any) => Promise<any> } },
 *   fetch?: typeof fetch
 * }} opts
 * @returns {Promise<{ events: unknown[] }>}
 */
export async function requestExtraction({
  text,
  filename,
  locale,
  today,
  tz,
  instruction,
  user,
  fetch: fetchImpl = (...a) => globalThis.fetch(...a)
}) {
  const url = new URL('/api/termi/extract', location.origin).href;
  const req = await buildSignedChatRequest({
    body: /** @type {any} */ ({
      text,
      filename,
      locale,
      today,
      tz,
      ...(instruction ? { instruction } : {})
    }),
    user,
    url
  });
  const res = await fetchImpl('/api/termi/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...req.headers },
    body: req.body
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new TermiChatHttpError(res.status, body?.scope);
  }
  const data = await res.json();
  return { events: Array.isArray(data?.events) ? data.events : [] };
}
