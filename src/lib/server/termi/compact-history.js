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
 * Returns a copy of `messages` with large tool inputs/outputs on OLD turns
 * (strictly before the most recent user message) replaced by
 * `{ _omitted, _original_chars }`. The current turn stays verbatim. Never
 * mutates the input; with no user message nothing is compacted.
 *
 * @param {UIMessage[]} messages
 * @returns {UIMessage[]}
 */
export function compactHistory(messages) {
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user');
  if (lastUserIdx === -1) return messages;

  return messages.map((msg, idx) => {
    if (idx >= lastUserIdx) return msg;

    let changed = false;
    const parts = msg.parts.map((part) => {
      const p = /** @type {{ type: string, input?: unknown, output?: unknown }} */ (part);
      if (!isToolPart(p.type)) return part;

      const input = maybeCompactField(p.input);
      const output = maybeCompactField(p.output);
      if (input === p.input && output === p.output) return part;

      changed = true;
      return /** @type {typeof part} */ ({ ...part, input, output });
    });

    return changed ? { ...msg, parts } : msg;
  });
}
