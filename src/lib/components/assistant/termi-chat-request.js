/**
 * The signed /api/termi/chat request: the body is stringified once and the
 * NIP-98 `payload` hash covers exactly that string (the route hashes the raw
 * body it receives).
 */
import { createNIP98AuthHeader } from '$lib/helpers/nip98.js';
import { rejectAfter } from '$lib/helpers/signer-wait.js';

const SIGN_TIMEOUT_MS = 30_000;

/**
 * @param {{
 *   body: { task: string, messages: unknown[] },
 *   user: { pubkey: string, signer: { signEvent: (draft: any) => Promise<any> } },
 *   url: string
 * }} opts
 * @returns {Promise<{ body: string, headers: { Authorization: string } }>}
 */
export async function buildSignedChatRequest({ body, user, url }) {
  const str = JSON.stringify(body);
  const Authorization = await createNIP98AuthHeader(url, 'POST', str, (draft) =>
    rejectAfter(
      Promise.resolve(user.signer.signEvent({ ...draft, pubkey: user.pubkey })),
      SIGN_TIMEOUT_MS,
      'Signing the Termi request'
    )
  );
  return { body: str, headers: { Authorization } };
}
