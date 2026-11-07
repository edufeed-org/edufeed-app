import { parseBool } from '../env-parse.js';
import { nopeMcpEnv } from '../nopeMcpEnv.js';

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
 * (there is no default model), a non-external model id and the nope-mcp URL
 * its search tool needs (else the chat route answers 503). Shared by
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
    !isExternalModelId(env.TERMI_LLM_MODEL) &&
    !!nopeMcpEnv(env, 'URL')
  );
}
