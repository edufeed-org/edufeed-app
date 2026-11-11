import { parseBool } from '../env-parse.js';
import { nopeMcpEnv } from '../nopeMcpEnv.js';
import { parseTermiDomains } from './eligibility.js';

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
 * `saia` (default: any OpenAI-compatible base URL, external ids refused) or
 * `anthropic` — an explicit opt-in that routes user text to Anthropic; it needs
 * a `claude-*` id and no base URL.
 * @param {Record<string, string | undefined>} env
 * @returns {'saia' | 'anthropic'}
 */
export function termiLlmProvider(env) {
  return (env.TERMI_LLM_PROVIDER || '').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'saia';
}

/**
 * Whether the Termi LLM assistant can run: flag on, every TERMI_LLM_* var set
 * (there is no default model), a model id that matches the provider (SAIA:
 * non-external; Anthropic: `claude-*`), the nope-mcp URL its search tool needs,
 * and at least one TERMI_ELIGIBLE_NIP05_DOMAINS entry (the assistant has no
 * gate-less mode); else the chat route answers 503. Shared by `/api/config`
 * (`termi.llm`) and `/api/termi/chat`.
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function isTermiLlmConfigured(env) {
  const anthropic = termiLlmProvider(env) === 'anthropic';
  const model = env.TERMI_LLM_MODEL || '';
  return (
    parseBool(env.TERMI_AI_ENABLED, false) &&
    (anthropic || !!env.TERMI_LLM_BASE_URL) &&
    !!env.TERMI_LLM_API_KEY &&
    !!model &&
    (anthropic ? /^claude-/i.test(model) : !isExternalModelId(model)) &&
    !!nopeMcpEnv(env, 'URL') &&
    parseTermiDomains(env).length > 0
  );
}
