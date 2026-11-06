/**
 * Client for the homelab embedding service (see
 * homelab/roles/embedding/templates/embed_service.py.j2 — the canonical wire
 * contract). `POST {url}/embed` with `{texts, input_type}` returns
 * `{embeddings}`. The service's `APIKeyHeader` does
 * `key.removeprefix("Bearer ")`, so a bare key (no "Bearer " prefix) is
 * accepted — that's what we send.
 */
import { parseBool } from '../env-parse.js';

/**
 * @param {string[]} texts
 * @param {'query'|'passage'} inputType
 * @param {{ url: string, apiKey: string, timeoutMs?: number }} opts
 * @returns {Promise<number[][]>}
 */
export async function embedTexts(texts, inputType, { url, apiKey, timeoutMs = 10_000 }) {
  const res = await fetch(`${url}/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ texts, input_type: inputType }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`embed service responded ${res.status}`);
  const data = await res.json();
  return data.embeddings;
}

/**
 * Whether Termi's embedding leg is fully configured — shared by `/api/config`
 * (capability flag) and `/api/termi` (whether to build the router index).
 * @param {{ TERMI_AI_ENABLED?: string, TERMI_EMBED_URL?: string, TERMI_EMBED_API_KEY?: string }} env
 * @returns {boolean}
 */
export function isEmbedConfigured(env) {
  return (
    parseBool(env.TERMI_AI_ENABLED, false) && !!env.TERMI_EMBED_URL && !!env.TERMI_EMBED_API_KEY
  );
}
