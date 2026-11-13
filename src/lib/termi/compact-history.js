/**
 * Ported from edufeed-chat-bot `src/lib/llm/compact-history.ts` (Unlicense).
 */

/** @typedef {import('ai').UIMessage} UIMessage */

/**
 * Above this size a tool-part `input`/`output` on an old turn is replaced by a
 * placeholder (~4 chars/token, so ≈ 1.25k tokens).
 */
const COMPACT_THRESHOLD_CHARS = 5_000;

/** @param {string} type */
function isToolPart(type) {
  // AI SDK v6: typed tool parts are "tool-{name}", untyped ones "dynamic-tool".
  return type === 'dynamic-tool' || type.startsWith('tool-');
}

/** @param {unknown} value */
function maybeCompactField(value) {
  if (value === undefined || value === null) return value;
  const size = JSON.stringify(value)?.length ?? 0;
  return size > COMPACT_THRESHOLD_CHARS ? { _omitted: true, _original_chars: size } : value;
}

/**
 * A part without provider metadata. A model's own thinking parts, signatures
 * and metadata may be rejected by another provider (a mid-chat model switch
 * or a fallback), so history carries text and tool calls/results only.
 * @param {any} part
 */
function withoutProviderMetadata(part) {
  const {
    providerMetadata: _p,
    callProviderMetadata: _c,
    resultProviderMetadata: _r,
    ...rest
  } = part;
  return rest;
}

/**
 * Returns a copy of `messages` without thinking parts (`reasoning`,
 * `reasoning-file`) and without provider metadata on the remaining parts, on
 * every turn; and with large tool inputs/outputs on OLD turns (strictly before
 * the most recent user message) replaced by `{ _omitted, _original_chars }`.
 * Never mutates the input.
 *
 * @param {UIMessage[]} messages
 * @returns {UIMessage[]}
 */
export function compactHistory(messages) {
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');

  return messages.map((msg, idx) => {
    const parts = msg.parts
      .filter((part) => part.type !== 'reasoning' && part.type !== 'reasoning-file')
      .map((part) => {
        const p = withoutProviderMetadata(part);
        if (idx >= lastUserIdx || !isToolPart(p.type)) return p;
        const input = maybeCompactField(p.input);
        const output = maybeCompactField(p.output);
        return input === p.input && output === p.output ? p : { ...p, input, output };
      });
    return { ...msg, parts };
  });
}
