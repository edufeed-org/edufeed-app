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

// unpdf bundles a pdf.js build that eagerly calls `Promise.try` at module
// evaluation. Some Node 22.x runtimes are missing it. Polyfill before the
// dynamic import resolves so pdf.js's top-level evaluation succeeds.
if (typeof Promise.try !== 'function') {
  /** @param {(...args: any[]) => any} fn */
  Promise.try = function (fn, ...args) {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}

/**
 * Plain-text extractor for the LLM. The wizard's existing
 * `pdfExtractor.js` is HTML-rendering / heuristic and lives in `$lib`;
 * for the LLM grounding all we need is concatenated page text, so
 * call unpdf's `extractText` directly (mergePages: true → single string).
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
async function pdfExtractText(buffer) {
  // Dynamic import so the Promise.try polyfill above is in place before
  // unpdf's bundled pdf.js evaluates at module-load.
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  // Cap to ~32k chars so absurdly large PDFs don't blow the prompt.
  return typeof text === 'string' ? text.slice(0, 32_000) : '';
}

const VARIANTS = new Set(['amb', 'ekw']);

/**
 * Map a Bildungsbereich key to the `SCHEME_NADDR_*` env var that holds the
 * corresponding subject vocabulary. Mirrors `BILDUNGSBEREICHE.subjectVocabKeys`
 * in `$lib/helpers/educational/bildungsbereich.js`. We can only feed one
 * subject vocab to the LLM at a time (the lib's `about` schema field accepts a
 * single snapshot), so for `extra` (which renders both schule + hochschule
 * pickers in the wizard) we pick the first key — same heuristic as
 * `bucketSubjectsForBildungsbereich`.
 *
 * @param {string | undefined} bildungsbereich
 * @returns {string | undefined} naddr, or undefined when no subject vocab applies
 */
function pickSubjectSchemeNaddr(bildungsbereich) {
  switch (bildungsbereich) {
    case 'schule':
    case 'extra':
      return env.SCHEME_NADDR_SCHULFAECHER;
    case 'hochschule':
      return env.SCHEME_NADDR_HOCHSCHULFAECHER;
    default:
      return undefined; // konfi etc. have no subject vocab
  }
}

/**
 * SKOS scheme map: form-field-name → naddr. The library passes these naddrs
 * to its vocab loader to build LLM grounding snapshots.
 *
 * @param {string | undefined} bildungsbereich - selects which subject vocab maps to `about`
 */
function buildSkosSchemes(bildungsbereich) {
  /** @type {Record<string, string>} */
  const schemes = {};
  if (env.SCHEME_NADDR_HCRT) schemes.learningResourceType = env.SCHEME_NADDR_HCRT;
  if (env.SCHEME_NADDR_EDUCATIONAL_LEVEL) {
    schemes.educationalLevels = env.SCHEME_NADDR_EDUCATIONAL_LEVEL;
  }
  const subjectNaddr = pickSubjectSchemeNaddr(bildungsbereich);
  if (subjectNaddr) schemes.about = subjectNaddr;
  if (env.SCHEME_NADDR_KLASSENSTUFEN) schemes.gradeLevels = env.SCHEME_NADDR_KLASSENSTUFEN;
  if (env.SCHEME_NADDR_SCHULART) schemes.schoolTypes = env.SCHEME_NADDR_SCHULART;
  if (env.SCHEME_NADDR_EKW_FACH) schemes.ekwFachrichtung = env.SCHEME_NADDR_EKW_FACH;
  if (env.SCHEME_NADDR_DIDAKTISCHES_KONZEPT) {
    schemes.didacticConcepts = env.SCHEME_NADDR_DIDAKTISCHES_KONZEPT;
  }
  if (env.SCHEME_NADDR_METHODE) schemes.methods = env.SCHEME_NADDR_METHODE;
  return schemes;
}

/** @type {import('amb-mcp/lib').AnthropicLike | null | undefined} */
let cachedLlmClient;
function getLlmClient() {
  if (cachedLlmClient !== undefined) return cachedLlmClient ?? undefined;
  cachedLlmClient = createAnthropicClient(env.ANTHROPIC_API_KEY) ?? null;
  return cachedLlmClient ?? undefined;
}

const BILDUNGSBEREICHE = new Set(['schule', 'hochschule', 'extra', 'konfi']);

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request }) {
  /** @type {{ url?: string, variant?: string, bildungsbereich?: string }} */
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

  const variantRaw = body.variant ?? 'amb';
  if (!VARIANTS.has(variantRaw)) {
    return json({ error: `Invalid variant '${variantRaw}'` }, { status: 400 });
  }
  const variant = /** @type {'amb' | 'ekw'} */ (variantRaw);

  const bildungsbereich =
    typeof body.bildungsbereich === 'string' && BILDUNGSBEREICHE.has(body.bildungsbereich)
      ? body.bildungsbereich
      : undefined;

  // Vocab relays are independent from AMB content relays (which host kind
  // 30142, not NIP-VOCAB schemes/concepts). The naddrs themselves carry
  // relay hints; SKOS_FALLBACK_RELAYS only kicks in for naddrs that omit
  // them (e.g. EDUCATIONAL_LEVEL). Mixing in unrelated content relays
  // races the slow vocab relay in the loader's pool query.
  const vocabRelays = (env.SKOS_FALLBACK_RELAYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const result = await extractMetadata({
      url,
      variant,
      skosSchemes: buildSkosSchemes(bildungsbereich),
      vocabRelays,
      pdfExtract: pdfExtractText,
      llmClient: getLlmClient()
    });
    return json(result);
  } catch (err) {
    console.error('[/api/enrich] extractMetadata failed:', err);
    return json({ error: 'Metadata extraction failed' }, { status: 500 });
  }
}
