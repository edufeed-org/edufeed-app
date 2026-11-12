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

/** A provider's short identifier (error type/code): `[A-Za-z0-9_.:-]` only, 60 chars at most. @param {unknown} v */
const ident = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60) : '');

/**
 * `onError` for `toUIMessageStream`: the client only learns that the upstream
 * failed (it renders its own copy). The server log gets the status and the
 * provider's short error type/code, never user text. `devMessages` (true only
 * when `TERMI_TRANSCRIPT_DIR` is set — the dev gate under which user text is
 * written to disk anyway) adds the provider's capped one-line message, which
 * may quote the offending input. The request body is never logged.
 * @param {unknown} err
 * @param {boolean} [devMessages]
 * @returns {string}
 */
export function streamErrorMessage(err, devMessages = false) {
  const e =
    /** @type {{ statusCode?: number, name?: string, message?: unknown, data?: any } | null} */ (
      err && typeof err === 'object' ? err : null
    );
  const http = typeof e?.statusCode === 'number';
  const kind = http
    ? [ident(e?.data?.error?.type), ident(e?.data?.error?.code)].filter(Boolean)
    : [];
  const message =
    http && devMessages && typeof e?.message === 'string'
      ? [e.message.replace(/\s+/g, ' ').slice(0, 300)]
      : [];
  console.error(
    '[/api/termi/chat] upstream failed:',
    e?.statusCode ?? e?.name ?? 'unknown',
    ...kind,
    ...message
  );
  return 'termi:upstream';
}
