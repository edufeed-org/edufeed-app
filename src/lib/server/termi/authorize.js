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

/** @param {string | undefined} value @param {number} defaultValue */
function positiveInt(value, defaultValue) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

export const termiQuota = createQuota({
  perUserDaily: positiveInt(env.TERMI_QUOTA_DAILY, 40),
  globalMonthly: positiveInt(env.TERMI_QUOTA_MONTHLY, 2800),
  stateFile: env.TERMI_STATE_DIR ? path.join(env.TERMI_STATE_DIR, 'termi-quota.json') : undefined
});

/** Steps on models outside GWDG (`anthropic:` ids): their own, smaller budget. */
export const termiExternalQuota = createQuota({
  perUserDaily: positiveInt(env.TERMI_EXTERNAL_QUOTA_DAILY, 20),
  globalMonthly: positiveInt(env.TERMI_EXTERNAL_QUOTA_MONTHLY, 600),
  stateFile: env.TERMI_STATE_DIR
    ? path.join(env.TERMI_STATE_DIR, 'termi-quota-external.json')
    : undefined
});

/** Pubkeys with a chat stream currently in flight. */
const chatInFlight = new Set();

/**
 * One chat stream per pubkey at a time (SAIA session reuse assumes it).
 * `null` means the caller should answer 429 busy. The returned release is
 * idempotent — safe to call more than once (finally + abort + onFinish all
 * call it).
 * @param {string} pubkey
 * @returns {(() => void) | null}
 */
export function acquireChatLock(pubkey) {
  if (chatInFlight.has(pubkey)) return null;
  chatInFlight.add(pubkey);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    chatInFlight.delete(pubkey);
  };
}

/**
 * 401 `Unauthorized` · 403 `not_eligible` · 503 `eligibility_unknown` ·
 * 429 `{ error: 'quota', scope }`. The caller charges the quota itself.
 * `quota: null` skips the quota check (the chat route checks the quota of the
 * chosen model's service once it knows it).
 * @param {Request} request
 * @param {string} rawBody non-empty (an empty body would skip the payload check)
 * @param {{ quota?: { check(pubkey: string): string } | null }} [opts]
 * @returns {Promise<{ pubkey: string } | Response>}
 */
export async function authorizeTermiRequest(request, rawBody, { quota = termiQuota } = {}) {
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

  const scope = quota?.check(pubkey) ?? 'ok';
  if (scope !== 'ok') return json({ error: 'quota', scope }, { status: 429 });
  return { pubkey };
}
