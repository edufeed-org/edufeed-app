/**
 * AI-content labelling for kind-1063 attestations (issue: "add attribute for
 * ai generated content in 1063 metadata").
 *
 * Tag convention: `["ai", "generated" | "modified"]` on the license event.
 * The two values mirror the EU AI Office's labelling icons
 * (https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content):
 *   - generated: fully AI-generated, no human-made elements (apart from prompting)
 *   - modified:  pre-existing human-made content partially modified with AI
 * No tag means "no AI involvement declared".
 *
 * Pure helpers, shared by the license form (write) and the image overlay (read).
 */

/** @typedef {'generated' | 'modified'} AiLabel */

/** @type {readonly AiLabel[]} */
export const AI_LABELS = Object.freeze(['generated', 'modified']);

/**
 * Coerce an arbitrary value to a known AI label, or null.
 * @param {unknown} value
 * @returns {AiLabel | null}
 */
export function normalizeAiLabel(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return AI_LABELS.includes(/** @type {AiLabel} */ (v)) ? /** @type {AiLabel} */ (v) : null;
}

/**
 * Read the AI label from a kind-1063 event's tags. Tags are untrusted network
 * input: the first `ai` tag carrying a KNOWN value wins; anything else is
 * ignored.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {AiLabel | null}
 */
export function getAiLabel(event) {
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'ai') continue;
    const label = normalizeAiLabel(tag[1]);
    if (label) return label;
  }
  return null;
}
