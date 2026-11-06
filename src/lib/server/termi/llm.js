/**
 * The Termi assistant's model on SAIA (GWDG's OpenAI-compatible API).
 */
import { createOpenAI } from '@ai-sdk/openai';
import { isTermiLlmConfigured } from './model-guard.js';

/**
 * `.chat()` on purpose: the default callable targets `/responses`, which SAIA
 * does not serve.
 * @param {Record<string, string | undefined>} env
 */
export function createTermiModel(env) {
  if (!isTermiLlmConfigured(env)) return null;
  return createOpenAI({ baseURL: env.TERMI_LLM_BASE_URL, apiKey: env.TERMI_LLM_API_KEY }).chat(
    /** @type {string} */ (env.TERMI_LLM_MODEL)
  );
}

/**
 * `onError` for `toUIMessageStreamResponse`: the client only learns that the
 * upstream failed (it renders its own copy); the upstream message never leaves
 * the server and is not logged (it may echo user text).
 * @param {unknown} err
 * @returns {string}
 */
export function streamErrorMessage(err) {
  const e = /** @type {{ statusCode?: number, name?: string } | null} */ (
    err && typeof err === 'object' ? err : null
  );
  console.error('[/api/termi/chat] upstream failed:', e?.statusCode ?? e?.name ?? 'unknown');
  return 'termi:upstream';
}
