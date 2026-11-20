import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env as privateEnv } from '$env/dynamic/private';
import { parseModelId } from '../../termi/model-id.js';
import { termiSaiaModels } from './model-guard.js';

/** @param {string | undefined} v */
const list = (v) =>
  (v || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

/**
 * The models Termi offers, built from a plain env object. Ids are `service:model`.
 * @param {Record<string, string | undefined>} env
 */
export function createCatalog(env) {
  const saia = termiSaiaModels(env).map((m) => `saia:${m}`);
  const external = list(env.TERMI_EXTERNAL_MODELS).map((m) => `anthropic:${m}`);
  const externalEnabled = external.length > 0 && !!env.TERMI_ANTHROPIC_API_KEY;
  const defaultId = saia[0];

  /** @param {string | undefined} id @param {{ listed: boolean }} opts */
  function resolve(id, { listed }) {
    const want = id ?? defaultId;
    const p = parseModelId(want);
    if (!p) return /** @type {const} */ ({ ok: false, status: 400, error: 'invalid_model' });
    if (p.service === 'saia') {
      if (!saia.includes(want))
        return /** @type {const} */ ({ ok: false, status: 400, error: 'invalid_model' });
      return {
        ok: /** @type {const} */ (true),
        id: want,
        candidates: [want, ...saia.filter((s) => s !== want)]
      };
    }
    if (!externalEnabled || !external.includes(want) || !listed)
      return /** @type {const} */ ({ ok: false, status: 403, error: 'model_not_allowed' });
    return { ok: /** @type {const} */ (true), id: want, candidates: [want] };
  }

  /** `.chat()` on purpose for SAIA: the default callable targets `/responses`, which SAIA lacks. @param {string} id */
  function model(id) {
    const p = parseModelId(id);
    if (!p) throw new Error('invalid model id');
    return p.service === 'saia'
      ? createOpenAI({ baseURL: env.TERMI_LLM_BASE_URL, apiKey: env.TERMI_LLM_API_KEY }).chat(
          p.model
        )
      : createAnthropic({ apiKey: env.TERMI_ANTHROPIC_API_KEY })(p.model);
  }

  return { saia, external, defaultId, externalEnabled, resolve, model };
}

/** @type {ReturnType<typeof createCatalog> | undefined} */
let catalog;

/** The process-wide catalog (chat and models routes share it). */
export function getCatalog() {
  return (catalog ??= createCatalog(privateEnv));
}

export function _resetCatalogForTests() {
  catalog = undefined;
}
