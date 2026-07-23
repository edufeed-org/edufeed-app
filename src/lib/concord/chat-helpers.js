// Pure tag-parsing helpers for the concord channel chat (ChannelChat.svelte).
// Kept free of Svelte/rxjs/applesauce imports so they are trivially unit-testable.

/**
 * Reply parent id of a concord kind-9 chat rumor.
 *
 * NOTE: this deliberately does NOT reuse message-utils.js's getReplyParentId(),
 * which expects the NIP-10 marked-`e`-tag convention (`["e", id, relay, "reply"]`)
 * used by the public Chat.svelte kind-9 flow. Concord's ChatMessageFactory#replyTo
 * (applesauce-common/factories/chat-message.js → includeChatReply →
 * ensureQuoteEventPointerTag) instead writes a NIP-C7 `q` tag
 * (`["q", id, relay, author]`) — verified in the concord-pinned applesauce-common
 * dist. Read that tag directly.
 *
 * @param {{ tags?: string[][], [key: string]: any }} message
 * @returns {string | null}
 */
export function getConcordReplyParentId(message) {
  return message.tags?.find((/** @type {string[]} */ t) => t[0] === 'q')?.[1] || null;
}

/**
 * Aggregate kind-7 reaction rumors into per-target emoji counts.
 *
 * ReactionFactory (applesauce-common/factories/reaction.js → setReactionParent)
 * writes a plain NIP-25 `"e"` tag via ensureEventPointerTag (no marker) — the
 * first `e` tag is the reacted-to message id. Empty content falls back to 👍
 * (a bare like); other contents ("+", custom emoji) are counted as-is.
 *
 * Returns plain Maps rebuilt fresh per call (never mutated across renders) —
 * same convention as ReactionBar.svelte's aggregateReactions(); SvelteMap is
 * not needed and can cause reactivity loops inside $derived.
 *
 * @param {Array<{ content?: string, tags?: string[][], [key: string]: any }>} reactions
 * @returns {Map<string, Map<string, number>>} target message id → (emoji → count)
 */
export function aggregateChannelReactions(reactions) {
  const map = new Map();
  for (const reaction of reactions) {
    const target = reaction.tags?.find((/** @type {string[]} */ t) => t[0] === 'e')?.[1];
    if (!target) continue;
    const emoji = reaction.content || '👍';
    const perMessage = map.get(target) ?? new Map();
    perMessage.set(emoji, (perMessage.get(emoji) ?? 0) + 1);
    map.set(target, perMessage);
  }
  return map;
}
