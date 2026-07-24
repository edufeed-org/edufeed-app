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
 * @typedef {Object} ChannelReactionSummary
 * @property {number} count - Number of reactions for this emoji
 * @property {boolean} userReacted - True if currentUserPubkey reacted with this emoji
 * @property {any} userReactionEvent - Always null (see note below)
 * @property {string|null} emojiUrl - Custom emoji URL (NIP-30) or null for unicode
 * @property {string[]} reactors - Pubkeys of all users who reacted with this emoji
 */

/**
 * NIP-30 custom-emoji URL for a reaction rumor whose content is a `:shortcode:`
 * referencing an `["emoji", shortcode, url]` tag. Local copy of
 * helpers/reactions.js's getCustomEmojiUrl — duplicated (not imported) to keep
 * this file free of Svelte/store-coupled imports (see file header).
 * @param {{content?: string, tags?: string[][]}} reaction
 * @returns {string|null}
 */
function getCustomEmojiUrl(reaction) {
  const content = reaction.content?.trim();
  if (!content) return null;
  const match = content.match(/^:([^:]+):$/);
  if (!match) return null;
  const shortcode = match[1];
  const emojiTag = reaction.tags?.find(
    (/** @type {string[]} */ t) => t[0] === 'emoji' && t[1] === shortcode
  );
  return emojiTag?.[2] || null;
}

/**
 * Aggregate kind-7 reaction rumors into per-target, per-emoji summaries — the
 * SAME shape as helpers/reactions.js's `aggregateReactions()`, so ChannelChat
 * can render concord reactions through the identical `ReactionChips`
 * presentational component the public chat uses (see ReactionBar.svelte).
 * Target/emoji-key rules are unchanged from the single-count version this
 * replaces: ReactionFactory (applesauce-common/factories/reaction.js →
 * setReactionParent) writes a plain NIP-25 `"e"` tag via ensureEventPointerTag
 * (no marker) — the first `e` tag is the reacted-to message id. Empty content
 * falls back to 👍 (a bare like); other contents ("+", custom emoji) are
 * counted as-is.
 *
 * `userReactionEvent` is always left `null`: applesauce-concord's
 * ConcordCommunity has no reaction-retract method in the pinned dist (no
 * `unreact`/`removeReaction`/`retract` in `applesauce-concord/dist/client/
 * community.js`), so ChannelChat never shows the delete affordance
 * ReactionButton renders when a real `userReactionEvent` is supplied.
 *
 * Returns plain Maps rebuilt fresh per call (never mutated across renders) —
 * same convention as ReactionBar.svelte's aggregateReactions(); SvelteMap is
 * not needed and can cause reactivity loops inside $derived.
 *
 * @param {Array<{ content?: string, tags?: string[][], pubkey?: string, [key: string]: any }>} reactions
 * @param {string|undefined} [currentUserPubkey] - Active user's pubkey (or undefined)
 * @returns {Map<string, Map<string, ChannelReactionSummary>>} target message id → (emoji → summary)
 */
export function aggregateChannelReactions(reactions, currentUserPubkey) {
  const map = new Map();
  for (const reaction of reactions) {
    const target = reaction.tags?.find((/** @type {string[]} */ t) => t[0] === 'e')?.[1];
    if (!target) continue;
    const emoji = reaction.content || '👍';
    const perMessage = map.get(target) ?? new Map();
    const existing = perMessage.get(emoji) || {
      count: 0,
      userReacted: false,
      userReactionEvent: null,
      emojiUrl: null,
      reactors: []
    };
    const isUserReaction = !!currentUserPubkey && reaction.pubkey === currentUserPubkey;
    // Reaction events are untrusted network input — a malformed/relay-mangled
    // event can arrive with no pubkey at all. Push only real ones, mirroring
    // the app's other tag-derived-data guards (CLAUDE.md's "Keyed {#each}
    // over Tag-Derived Data Must Be Deduped").
    if (reaction.pubkey) existing.reactors.push(reaction.pubkey);
    perMessage.set(emoji, {
      count: existing.count + 1,
      userReacted: existing.userReacted || isUserReaction,
      userReactionEvent: null,
      emojiUrl: existing.emojiUrl || getCustomEmojiUrl(reaction),
      reactors: existing.reactors
    });
    map.set(target, perMessage);
  }
  return map;
}
