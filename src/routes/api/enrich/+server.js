/**
 * URL → Form-prefill metadata enrichment endpoint.
 *
 * Thin proxy over the deployed AMB MCP server's `extract_metadata` tool.
 * The MCP server owns LLM grounding, PDF extraction, and SKOS vocab loading;
 * this route's job is request validation + per-request `skosSchemes` mapping
 * (since which subject vocab applies depends on the wizard's `bildungsbereich`
 * selection, which is dynamic per-call).
 *
 * Validation: http(s) URL, variant ∈ {amb, ekw, konfi}.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { callExtractMetadata } from '$lib/server/ambMcpClient.js';
import { parseHttpUrl } from '$lib/server/httpUrl.js';

const VARIANTS = new Set(['amb', 'ekw', 'konfi']);
const BILDUNGSBEREICHE = new Set(['schule', 'hochschule', 'extra', 'konfi']);

/** Upper bound on sources per extraction — mirrors amb-mcp's MAX_SOURCE_URLS. */
const MAX_SOURCE_URLS = 10;

/**
 * Map a Bildungsbereich key to the `SCHEME_NADDR_*` env var that holds the
 * corresponding subject vocabulary. Mirrors `BILDUNGSBEREICHE.subjectVocabKeys`
 * in `$lib/helpers/educational/bildungsbereich.js`. We can only feed one
 * subject vocab to the LLM at a time (the schema's `about` field accepts a
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
 * SKOS scheme map: form-field-name → naddr. The MCP server's vocab loader
 * uses these naddrs to build LLM grounding snapshots.
 *
 * Variant-specific:
 *  - `ekw` swaps in `SCHEME_NADDR_EKW_LRT` for `learningResourceType` (curated
 *    by EKKW) and includes school-context schemes (gradeLevels, schoolTypes,
 *    ekwFachrichtung, didacticConcepts, methods).
 *  - `konfi` reuses the EKW LRT vocab (Stationenlernen etc. apply to konfi
 *    contexts too) but swaps in 11 konfi-specific schemes for the wizard's
 *    Konfi-Arbeit form fields, and omits school-context schemes (those would
 *    mis-steer the LLM into proposing EKW fields the konfi schema rejects).
 *  - `amb` (default) uses HCRT + the bildungsbereich-driven subject vocab.
 *
 * Must stay aligned with the wizard's variant-specific pickers (see
 * `ResourceFormWizard.svelte`).
 *
 * @param {'amb' | 'ekw' | 'konfi'} variant
 * @param {string | undefined} bildungsbereich - selects which subject vocab maps to `about` (amb only)
 * @returns {Record<string, string>}
 */
function buildSkosSchemes(variant, bildungsbereich) {
  /** @type {Record<string, string>} */
  const schemes = {};
  const lrtNaddr =
    (variant === 'ekw' || variant === 'konfi') && env.SCHEME_NADDR_EKW_LRT
      ? env.SCHEME_NADDR_EKW_LRT
      : env.SCHEME_NADDR_HCRT;
  if (lrtNaddr) schemes.learningResourceType = lrtNaddr;

  if (variant === 'konfi') {
    if (env.SCHEME_NADDR_LANDESKIRCHEN) schemes.landeskirchen = env.SCHEME_NADDR_LANDESKIRCHEN;
    if (env.SCHEME_NADDR_KONFI_ZIELGRUPPEN) {
      schemes.konfiZielgruppen = env.SCHEME_NADDR_KONFI_ZIELGRUPPEN;
    }
    if (env.SCHEME_NADDR_KONFI_LERNFORMAT) {
      schemes.konfiLernformat = env.SCHEME_NADDR_KONFI_LERNFORMAT;
    }
    if (env.SCHEME_NADDR_KONFI_ZEITSTRUKTUR) {
      schemes.konfiZeitstruktur = env.SCHEME_NADDR_KONFI_ZEITSTRUKTUR;
    }
    if (env.SCHEME_NADDR_KONFI_BETEILIGTE) {
      schemes.konfiBeteiligte = env.SCHEME_NADDR_KONFI_BETEILIGTE;
    }
    if (env.SCHEME_NADDR_KONFI_THEMEN) schemes.konfiThemen = env.SCHEME_NADDR_KONFI_THEMEN;
    if (env.SCHEME_NADDR_KONFI_DIMENSIONEN) {
      schemes.konfiDimensionen = env.SCHEME_NADDR_KONFI_DIMENSIONEN;
    }
    if (env.SCHEME_NADDR_KONFI_METHODE) schemes.konfiMethode = env.SCHEME_NADDR_KONFI_METHODE;
    if (env.SCHEME_NADDR_KONFI_MATERIALAUFWAND) {
      schemes.konfiMaterialaufwand = env.SCHEME_NADDR_KONFI_MATERIALAUFWAND;
    }
    if (env.SCHEME_NADDR_KONFI_TECHNIKBEDARF) {
      schemes.konfiTechnikbedarf = env.SCHEME_NADDR_KONFI_TECHNIKBEDARF;
    }
    if (env.SCHEME_NADDR_KONFI_LERNORTE) schemes.konfiLernorte = env.SCHEME_NADDR_KONFI_LERNORTE;
    return schemes;
  }

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

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request }) {
  /** @type {{ url?: string, urls?: unknown, variant?: string, bildungsbereich?: string }} */
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Accept either a single `url` or a `urls` array (multi-source extraction).
  // Normalize to an array; the `urls` form falls back to `[url]` when absent.
  const rawUrls = Array.isArray(body.urls)
    ? body.urls
    : typeof body.url === 'string'
      ? [body.url]
      : [];
  const urls = rawUrls
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => u.length > 0);
  if (urls.length === 0) {
    return json({ error: 'Missing url(s)' }, { status: 400 });
  }
  if (urls.length > MAX_SOURCE_URLS) {
    return json({ error: `Too many URLs (max ${MAX_SOURCE_URLS})` }, { status: 400 });
  }
  if (!urls.every((u) => parseHttpUrl(u))) {
    return json({ error: 'Each URL must be a valid http or https URL' }, { status: 400 });
  }

  const variantRaw = body.variant ?? 'amb';
  if (!VARIANTS.has(variantRaw)) {
    return json({ error: `Invalid variant '${variantRaw}'` }, { status: 400 });
  }
  const variant = /** @type {'amb' | 'ekw' | 'konfi'} */ (variantRaw);

  const bildungsbereich =
    typeof body.bildungsbereich === 'string' && BILDUNGSBEREICHE.has(body.bildungsbereich)
      ? body.bildungsbereich
      : undefined;

  const mcpUrl = env.AMB_MCP_URL;
  if (!mcpUrl) {
    console.error('[/api/enrich] AMB_MCP_URL is not configured');
    return json({ error: 'Metadata extraction not configured' }, { status: 503 });
  }

  // Stream whitespace heartbeats every HEARTBEAT_MS while the upstream MCP
  // `extract_metadata` is in flight, then write the final JSON result and
  // close. Without this, browsers/proxies drop the idle long-poll with
  // `ERR_NETWORK_CHANGED` (observed for ~30s+ PDF extracts). JSON.parse
  // ignores leading whitespace, so the client (`await res.json()`) sees the
  // same payload it would have seen from a buffered response — no client
  // changes required.
  //
  // Headers commit before the upstream call resolves, so on error we cannot
  // switch to status 500. Instead we write a structured `{error, code}`
  // envelope as the JSON body. `enrichFromUrl` passes that through so the
  // wizard can show a useful hint ("KI-Service vorübergehend nicht
  // erreichbar") instead of a generic "failed" message.
  const HEARTBEAT_MS = 5_000;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(' '));
        } catch {
          // controller already closed; ignore
        }
      }, HEARTBEAT_MS);
      try {
        const result = await callExtractMetadata({
          mcpUrl,
          bearerToken: env.AMB_MCP_BEARER_TOKEN,
          urls,
          variant,
          skosSchemes: buildSkosSchemes(variant, bildungsbereich)
        });
        controller.enqueue(enc.encode(JSON.stringify(result)));
      } catch (err) {
        console.error('[/api/enrich] extract_metadata failed:', err);
        const code = /** @type {{ code?: unknown }} */ (err)?.code;
        const body = {
          error: 'ai_unavailable',
          code: typeof code === 'string' ? code : 'unknown'
        };
        controller.enqueue(enc.encode(JSON.stringify(body)));
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
