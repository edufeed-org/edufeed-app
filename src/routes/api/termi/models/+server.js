/**
 * POST /api/termi/models — what Termi's model menu needs. Signed like the chat
 * request (NIP-98 over the raw body `{}`, same gate); costs nothing: no lock, no
 * quota step, no quota refusal. → `{ default, models: [{ id, name, state? }],
 * external?: { models: [{ id, name }], left, total } }`. `state` (ready/busy/down)
 * is absent when SAIA's status could not be read; a model on cooldown is `down`.
 * `external` exists only when the catalog offers outside models AND the signer is
 * on the access list — for everyone else the response has no such key at all.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCatalog } from '$lib/server/termi/models.js';
import { isTermiLlmConfigured } from '$lib/server/termi/model-guard.js';
import { createModelStatus } from '$lib/server/termi/model-status.js';
import { getExternalAccess } from '$lib/server/termi/external-access.js';
import { modelCooldown } from '$lib/server/termi/fallback-model.js';
import { authorizeTermiRequest, termiExternalQuota } from '$lib/server/termi/authorize.js';
import { parseModelId } from '$lib/termi/model-id.js';

/** @type {Record<string, string>} */
const ANTHROPIC_NAMES = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5'
};

/** @type {ReturnType<typeof createModelStatus> | undefined} */
let status;

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request }) {
  if (!isTermiLlmConfigured(env)) return json({ error: 'termi_llm_disabled' }, { status: 503 });
  const rawBody = await request.text();
  if (!rawBody) return json({ error: 'invalid_json' }, { status: 400 });

  const auth = await authorizeTermiRequest(request, rawBody, { quota: null });
  if (auth instanceof Response) return auth;

  const catalog = getCatalog();
  status ??= createModelStatus({
    baseUrl: env.TERMI_LLM_BASE_URL ?? '',
    apiKey: env.TERMI_LLM_API_KEY ?? ''
  });
  const saia = await status.get();
  const bare = (/** @type {string} */ id) => parseModelId(id)?.model ?? id;

  const models = catalog.saia.map((id) => {
    const s = saia[bare(id)];
    const state = modelCooldown.skip(id) ? 'down' : s?.state;
    return { id, name: s?.name ?? bare(id), ...(state ? { state } : {}) };
  });

  /** @type {Record<string, unknown>} */
  const body = { default: catalog.defaultId, models };
  if (catalog.externalEnabled && (await getExternalAccess().isListed(auth.pubkey))) {
    body.external = {
      models: catalog.external.map((id) => ({ id, name: ANTHROPIC_NAMES[bare(id)] ?? bare(id) })),
      ...termiExternalQuota.remaining(auth.pubkey)
    };
  }
  return json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}
