/**
 * Eligibility probe for the Termi assistant's NIP-05 gate.
 *
 * `GET ?pubkey=<hex|npub>` → `{ eligible, gated: true }`, `eligible` being
 * `true`, `false` or `null` (a directory could not be loaded yet). Same shape
 * as /api/blossom/eligible; same origin only (the app is the only caller).
 */
import { json } from '@sveltejs/kit';
import { normalizePubkey } from '$lib/server/blossom-eligibility.js';
import { getTermiEligibilityChecker } from '$lib/server/termi/eligibility.js';

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const pubkey = normalizePubkey(url.searchParams.get('pubkey'));
  if (!pubkey) return json({ error: 'pubkey must be 64 hex chars or an npub' }, { status: 400 });
  const eligible = await getTermiEligibilityChecker().isEligible(pubkey);
  return json({ eligible, gated: true }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
