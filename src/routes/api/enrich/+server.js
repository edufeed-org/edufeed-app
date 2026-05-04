/**
 * URL → Form-prefill metadata enrichment endpoint.
 *
 * Wraps `extractMetadata` from `amb-mcp/lib`. Builds the SKOS-scheme map from
 * the same `SCHEME_NADDR_*` env vars the runtime config uses, and constructs
 * an Anthropic client when `ANTHROPIC_API_KEY` is set. Without the key, the
 * library degrades to OpenGraph-only output — same code path.
 *
 * Validation: http(s) URL, variant ∈ {amb, ekw}.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createAnthropicClient, extractMetadata } from 'amb-mcp/lib';

const VARIANTS = new Set(['amb', 'ekw']);

/**
 * SKOS scheme map: form-field-name → naddr. The library passes these naddrs
 * to its vocab loader to build LLM grounding snapshots.
 */
function buildSkosSchemes() {
  /** @type {Record<string, string>} */
  const schemes = {};
  if (env.SCHEME_NADDR_HCRT) schemes.learningResourceType = env.SCHEME_NADDR_HCRT;
  if (env.SCHEME_NADDR_EDUCATIONAL_LEVEL) {
    schemes.educationalLevels = env.SCHEME_NADDR_EDUCATIONAL_LEVEL;
  }
  if (env.SCHEME_NADDR_KLASSENSTUFEN) schemes.gradeLevels = env.SCHEME_NADDR_KLASSENSTUFEN;
  if (env.SCHEME_NADDR_SCHULART) schemes.schoolTypes = env.SCHEME_NADDR_SCHULART;
  if (env.SCHEME_NADDR_EKW_FACH) schemes.ekwFachrichtung = env.SCHEME_NADDR_EKW_FACH;
  if (env.SCHEME_NADDR_DIDAKTISCHES_KONZEPT) {
    schemes.didacticConcepts = env.SCHEME_NADDR_DIDAKTISCHES_KONZEPT;
  }
  if (env.SCHEME_NADDR_METHODE) schemes.methods = env.SCHEME_NADDR_METHODE;
  return schemes;
}

let cachedLlmClient;
function getLlmClient() {
  if (cachedLlmClient !== undefined) return cachedLlmClient;
  cachedLlmClient = createAnthropicClient(env.ANTHROPIC_API_KEY) ?? null;
  return cachedLlmClient ?? undefined;
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request }) {
  /** @type {{ url?: string, variant?: string }} */
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) {
    return json({ error: 'Missing url' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return json({ error: 'Invalid url' }, { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json({ error: 'URL must be http or https' }, { status: 400 });
  }

  const variant = body.variant ?? 'amb';
  if (!VARIANTS.has(variant)) {
    return json({ error: `Invalid variant '${variant}'` }, { status: 400 });
  }

  try {
    const result = await extractMetadata({
      url,
      variant,
      skosSchemes: buildSkosSchemes(),
      llmClient: getLlmClient()
    });
    return json(result);
  } catch (err) {
    console.error('[/api/enrich] extractMetadata failed:', err);
    return json({ error: 'Metadata extraction failed' }, { status: 500 });
  }
}
