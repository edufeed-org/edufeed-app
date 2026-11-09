/**
 * The guards every signed Termi LLM route shares (/api/termi/chat,
 * /api/termi/extract): NIP-98 over the raw body → the NIP-05 gate → the
 * quota. One quota instance for both routes — they spend the same SAIA budget.
 */
import path from 'node:path';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98Header } from '$lib/server/nip98-verify.js';
import { createQuota } from '$lib/server/termi/quota.js';
import { getTermiEligibilityChecker } from '$lib/server/termi/eligibility.js';

export const termiQuota = createQuota({
  perUserDaily: 40,
  globalMonthly: 2800,
  stateFile: env.TERMI_STATE_DIR ? path.join(env.TERMI_STATE_DIR, 'termi-quota.json') : undefined
});

/**
 * 401 `Unauthorized` · 403 `not_eligible` · 503 `eligibility_unknown` ·
 * 429 `{ error: 'quota', scope }`. The caller charges the quota itself.
 * @param {Request} request
 * @param {string} rawBody non-empty (an empty body would skip the payload check)
 * @returns {Promise<{ pubkey: string } | Response>}
 */
export async function authorizeTermiRequest(request, rawBody) {
  const pubkey = await verifyNip98Header(
    request.headers.get('authorization'),
    request.url,
    'POST',
    rawBody
  );
  if (!pubkey) return json({ error: 'Unauthorized' }, { status: 401 });

  const eligible = await getTermiEligibilityChecker().isEligible(pubkey);
  if (eligible === false) return json({ error: 'not_eligible' }, { status: 403 });
  if (eligible === null) return json({ error: 'eligibility_unknown' }, { status: 503 });

  const scope = termiQuota.check(pubkey);
  if (scope !== 'ok') return json({ error: 'quota', scope }, { status: 429 });
  return { pubkey };
}
