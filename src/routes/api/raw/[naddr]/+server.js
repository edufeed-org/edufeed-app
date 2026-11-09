/**
 * GET /api/raw/<naddr>[.md] — an article (30023) or draft (30024) as a
 * LiaScript course, for `https://LiaScript.github.io/course/?<this URL>`.
 */
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { decodeIdentifier, fetchEventResultFromRelays } from '$lib/server/relay-fetch.js';
import { liascriptMarkdown, isBlockedPubkey } from '$lib/server/liascript.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params }) {
  const naddr = params.naddr.replace(/\.md$/, '');
  const decoded = decodeIdentifier(naddr);
  if (
    decoded?.type !== 'naddr' ||
    ![30023, 30024].includes(decoded.kind) ||
    isBlockedPubkey(decoded.pubkey, env.BLOCKED_PUBKEYS)
  ) {
    error(404, 'Not found');
  }
  const { event, complete } = await fetchEventResultFromRelays(naddr);
  if (!event) error(complete ? 404 : 503, complete ? 'Not found' : 'Relays did not answer');
  return new Response(liascriptMarkdown(event), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60'
    }
  });
}
