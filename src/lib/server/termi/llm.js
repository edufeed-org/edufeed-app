/** The Termi assistant's default model: SAIA (GWDG's OpenAI-compatible API), via the catalog. */
import { isTermiLlmConfigured } from './model-guard.js';
import { createCatalog } from './models.js';

/** @param {Record<string, string | undefined>} env */
export function createTermiModel(env) {
  if (!isTermiLlmConfigured(env)) return null;
  const catalog = createCatalog(env);
  return catalog.model(catalog.defaultId);
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
  // every candidate failed (fallback-model.js): the client offers another model
  if (/** @type {any} */ (e)?.code === 'unavailable') {
    console.error('[/api/termi/chat] no model available');
    return 'termi:unavailable';
  }
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
