/**
 * The Termi assistant's model: SAIA (GWDG's OpenAI-compatible API) by default,
 * or Anthropic when `TERMI_LLM_PROVIDER=anthropic` is set on purpose (a dev
 * fallback while SAIA is unreliable, laoc 2026-11-11 — the privacy text names
 * GWDG as the recipient, so production stays on SAIA).
 */
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { isTermiLlmConfigured, termiLlmProvider } from './model-guard.js';

/**
 * `.chat()` on purpose for SAIA: the default callable targets `/responses`,
 * which SAIA does not serve.
 * @param {Record<string, string | undefined>} env
 */
export function createTermiModel(env) {
  if (!isTermiLlmConfigured(env)) return null;
  const model = /** @type {string} */ (env.TERMI_LLM_MODEL);
  if (termiLlmProvider(env) === 'anthropic') {
    return createAnthropic({ apiKey: env.TERMI_LLM_API_KEY })(model);
  }
  return createOpenAI({ baseURL: env.TERMI_LLM_BASE_URL, apiKey: env.TERMI_LLM_API_KEY }).chat(
    model
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
