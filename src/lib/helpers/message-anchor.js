/**
 * Message-anchor helpers — deep links to a single chat message.
 *
 * A message link is the channel URL plus `?message=<event id>`; the chat that
 * renders the channel scrolls the matching row into view and flashes it.
 * Shared by the NIP-29 GroupChat and the Concord ChannelChat so the two
 * engines cannot drift on the URL shape or the highlight behaviour.
 */

/** CSS class flashed on the anchored row (styled in ChatMessageRow). */
export const MESSAGE_HIGHLIGHT_CLASS = 'chat-message-highlight';

/**
 * Build a shareable URL for a message inside a channel, off the current
 * location. Existing params (e.g. `view=channels`) are preserved; a stale
 * `channel`/`message` pair is overwritten.
 *
 * @param {{origin: string, pathname: string, search: string}} location
 * @param {string} channelId
 * @param {string} messageId
 * @returns {string}
 */
export function buildMessageDeepLink(location, channelId, messageId) {
  const params = new URLSearchParams(location.search);
  params.set('channel', channelId);
  params.set('message', messageId);
  return `${location.origin}${location.pathname}?${params.toString()}`;
}

/**
 * Scroll the chat row carrying `data-message-id={messageId}` into view and
 * flash the highlight class on it.
 *
 * @param {ParentNode | null | undefined} root - container to search in
 * @param {string} messageId
 * @param {{highlightMs?: number}} [options]
 * @returns {boolean} true when the row was found
 */
export function scrollToChatMessage(root, messageId, { highlightMs = 2000 } = {}) {
  // Manual string-escape instead of CSS.escape — jsdom (vitest) doesn't
  // expose the CSS global, and inside a quoted attribute selector escaping
  // quote + backslash is sufficient. Real ids are hex event ids anyway.
  const escaped = messageId.replace(/["\\]/g, '\\$&');
  const el = root?.querySelector?.(`[data-message-id="${escaped}"]`);
  if (!el) return false;
  // jsdom has no scrollIntoView — the highlight alone still marks the row.
  if (typeof (/** @type {any} */ (el).scrollIntoView) === 'function') {
    /** @type {any} */ (el).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  el.classList.add(MESSAGE_HIGHLIGHT_CLASS);
  setTimeout(() => el.classList.remove(MESSAGE_HIGHLIGHT_CLASS), highlightMs);
  return true;
}
