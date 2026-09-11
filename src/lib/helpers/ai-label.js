/**
 * AI-content labelling for kind-1063 attestations (issue: "add attribute for
 * ai generated content in 1063 metadata"), extended to the twillo / edu-sharing
 * model (issue: "Harmonize AI hint with twillo").
 *
 * Tag conventions on the license event:
 *
 *   ["ai", "generated" | "modified"]
 *     EU AI Office labelling icons
 *     (https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content):
 *       - generated: fully AI-generated, no human-made elements (apart from prompting)
 *       - modified:  pre-existing human-made content partially modified with AI
 *     No tag means "no AI involvement declared".
 *     twillo: ccm:commonlicense_ai_generated = true ↔ "generated".
 *
 *   ["ai-tool", <label>, <conceptUri>?]
 *     Tool / model used for generation. `label` is always human-readable; the
 *     optional third element is a concept URI from edu-sharing's aiTools SKOS
 *     scheme (AI_TOOLS_SCHEME) so twillo and edufeed name the same tool the
 *     same way. twillo: ccm:commonlicense_ai_tool (multi-valued URI).
 *
 *   ["ai-edited", "true"]
 *     The AI-generated file was manually edited / substantially changed after
 *     generation. twillo: ccm:commonlicense_ai_manually_modified = true.
 *
 *   ["ai-training", "allowed" | "disallowed"]
 *     Whether the file may be used to train AI models. twillo:
 *     ccm:commonlicense_ai_allow_usage (boolean, default true). Absent tag =
 *     no statement (attestations written before this convention existed).
 *
 * Pure helpers, shared by the license form (write) and the image overlay (read).
 */

/** @typedef {'generated' | 'modified'} AiLabel */
/** @typedef {'allowed' | 'disallowed'} AiTraining */
/** @typedef {{ label: string, id: string | null }} AiTool */

/** @type {readonly AiLabel[]} */
export const AI_LABELS = Object.freeze(['generated', 'modified']);

/** @type {readonly AiTraining[]} */
export const AI_TRAINING = Object.freeze(['allowed', 'disallowed']);

/**
 * edu-sharing's "AI-Tools & AI-Netzwerke" concept scheme, which twillo's
 * ccm:commonlicense_ai_tool values point into. Concepts are published at
 * https://vocabs.edu-sharing.net/w3id.org/edu-sharing/vocabs/aiTools/index.json
 * — mirrored here so the picker works offline and identifiers stay identical.
 */
export const AI_TOOLS_SCHEME = 'http://w3id.org/edu-sharing/vocabs/aiTools/';

/** @type {readonly { id: string, label: string }[]} */
export const AI_TOOLS = Object.freeze([
  { id: `${AI_TOOLS_SCHEME}4dd60dfa-9f8a-4cc9-b733-0125448f77a3`, label: 'OpenAI ChatGPT' },
  { id: `${AI_TOOLS_SCHEME}67a64d33-4077-4a8a-be60-9c66382717e7`, label: 'Google Gemini' }
]);

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
 * Coerce an arbitrary value to a known AI-training permission, or null.
 * @param {unknown} value
 * @returns {AiTraining | null}
 */
export function normalizeAiTraining(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return AI_TRAINING.includes(/** @type {AiTraining} */ (v)) ? /** @type {AiTraining} */ (v) : null;
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

/** @param {unknown} value */
const isHttpUri = (value) => typeof value === 'string' && /^https?:\/\/\S+$/.test(value);

/**
 * Read the generating tool from the first usable `ai-tool` tag. A bare known
 * concept URI in the label slot (a client that stored only the identifier)
 * resolves to its label; an unknown third element is not a URI and is dropped.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {AiTool | null}
 */
export function getAiTool(event) {
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'ai-tool') continue;
    const raw = typeof tag[1] === 'string' ? tag[1].trim() : '';
    if (!raw) continue;
    const known = AI_TOOLS.find((t) => t.id === raw);
    if (known) return { label: known.label, id: known.id };
    return { label: raw, id: isHttpUri(tag[2]) ? tag[2] : null };
  }
  return null;
}

/**
 * True when the attestation states the AI output was manually edited afterwards.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {boolean}
 */
export function getAiEdited(event) {
  return (event?.tags ?? []).some(
    (tag) =>
      tag[0] === 'ai-edited' && typeof tag[1] === 'string' && tag[1].trim().toLowerCase() === 'true'
  );
}

/**
 * Read the AI-training permission; null when the attestation makes no statement.
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {AiTraining | null}
 */
export function getAiTraining(event) {
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'ai-training') continue;
    const value = normalizeAiTraining(tag[1]);
    if (value) return value;
  }
  return null;
}
