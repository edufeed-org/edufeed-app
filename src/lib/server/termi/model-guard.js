import { parseBool } from '../env-parse.js';

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
 * Whether the Termi LLM assistant can run: flag on, every TERMI_LLM_* var set
 * (there is no default model) and a non-external model id. Shared by
 * `/api/config` (`termi.llm`) and `/api/termi/chat`.
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function isTermiLlmConfigured(env) {
  return (
    parseBool(env.TERMI_AI_ENABLED, false) &&
    !!env.TERMI_LLM_BASE_URL &&
    !!env.TERMI_LLM_API_KEY &&
    !!env.TERMI_LLM_MODEL &&
    !isExternalModelId(env.TERMI_LLM_MODEL)
  );
}
