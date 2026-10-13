/**
 * Public eligibility probe for the closed Blossom server.
 *
 * `GET ?pubkey=<hex|npub>[&refresh=1]` → `{ eligible, gated }`. The client
 * uses it to pick an upload target and to show the Termi hints; the answer is
 * not a secret (anyone can learn it by attempting an upload), so it is CORS
 * open. `refresh=1` asks the policy to bypass its cache (throttled server-side)
 * — the client sends it right after a NIP-05 handle was granted.
 */
import { json } from '@sveltejs/kit';
import { getEligibilityChecker, normalizePubkey } from '$lib/server/blossom-eligibility.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const pubkey = normalizePubkey(url.searchParams.get('pubkey'));
  if (!pubkey) {
    return json(
      { error: 'pubkey must be 64 hex chars or an npub' },
      { status: 400, headers: CORS }
    );
  }
  const checker = getEligibilityChecker();
  const eligible = await checker.isEligible(pubkey, {
    refresh: url.searchParams.get('refresh') === '1'
  });
  return json(
    { eligible, gated: checker.gated },
    { headers: { ...CORS, 'Cache-Control': 'private, max-age=60' } }
  );
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type'
    }
  });
}
