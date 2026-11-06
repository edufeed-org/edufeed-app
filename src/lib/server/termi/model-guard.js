/**
 * Refuses model ids that point at an external (non-SAIA) provider, so a
 * misconfigured TERMI_LLM_MODEL can't send user text to OpenAI/Anthropic.
 * @param {string | undefined} id
 * @returns {boolean}
 */
export function isExternalModelId(id) {
  return /^(gpt-|o\d|claude-)/i.test(id || '');
}
