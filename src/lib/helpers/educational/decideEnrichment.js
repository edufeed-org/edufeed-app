/**
 * Decide what to do after the URL fetch on Step 2 of the resource wizard,
 * given the user's chosen enrichment mode and what the page actually yielded.
 *
 * The wizard supports a per-resource opt-in for the LLM enrichment pass.
 * Three terminal outcomes:
 *
 *   - 'call-llm'    → fire `/api/enrich` and surface the pending banner
 *   - 'skip-amb'    → page already has AMB JSON-LD; no LLM needed (info chip)
 *   - 'skip-manual' → user chose manual mode; do nothing further
 *
 * Defensive default: anything we don't recognize collapses to 'skip-manual'
 * so we never silently spend an LLM token.
 *
 * @param {{ mode: 'smart' | 'manual', fetchSource: 'amb' | 'opengraph' | 'none' }} input
 * @returns {'call-llm' | 'skip-amb' | 'skip-manual'}
 */
export function decideEnrichment({ mode, fetchSource }) {
  if (fetchSource === 'amb') return 'skip-amb';
  if (mode === 'smart') return 'call-llm';
  return 'skip-manual';
}
