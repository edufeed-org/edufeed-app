import { parseBool } from '../env-parse.js';
import { nopeMcpEnv } from '../nopeMcpEnv.js';
import { parseTermiDomains } from './eligibility.js';
import { parseModelId } from '../../termi/model-id.js';

/**
 * Refuses model ids that point at an external (non-SAIA) provider, so a
 * misconfigured TERMI_LLM_MODEL can't send user text to OpenAI/Anthropic.
 * @param {string | undefined} id
 * @returns {boolean}
 */
export function isExternalModelId(id) {
  return /^(gpt-|o\d|claude-)/i.test(id || '');
}

/**
 * The SAIA model ids (bare) the deployment offers: `TERMI_LLM_MODELS` (comma
 * list) or the single `TERMI_LLM_MODEL`, external-looking ids and ids no
 * `saia:` catalog id can hold (`org/model`, over 80 chars) dropped.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function termiSaiaModels(env) {
  return (env.TERMI_LLM_MODELS || env.TERMI_LLM_MODEL || '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m && !isExternalModelId(m) && parseModelId(`saia:${m}`));
}

/**
 * Whether the Termi LLM assistant can run: flag on, every TERMI_LLM_* var set
 * (there is no default model), at least one non-external SAIA model id, the nope-mcp URL its search tool needs,
 * and at least one TERMI_ELIGIBLE_NIP05_DOMAINS entry (the assistant has no
 * gate-less mode); else the chat route answers 503. Shared by `/api/config`
 * (`termi.llm`) and `/api/termi/chat`.
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function isTermiLlmConfigured(env) {
  return (
    parseBool(env.TERMI_AI_ENABLED, false) &&
    !!env.TERMI_LLM_BASE_URL &&
    !!env.TERMI_LLM_API_KEY &&
    termiSaiaModels(env).length > 0 &&
    !!nopeMcpEnv(env, 'URL') &&
    parseTermiDomains(env).length > 0
  );
}
