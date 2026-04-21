import { getParsedContent } from 'applesauce-content/text';

// Custom cache symbol for kind 1111 comments (avoid collision with kind 1)
const CommentContentSymbol = Symbol('comment-content');

/**
 * Parse event content into a NAST tree with emoji, mention, link nodes.
 * Uses applesauce-content's default transformer pipeline with caching.
 * @param {import('nostr-tools').Event} event
 * @returns {import('applesauce-content/nast').Root}
 */
export function parseEventContent(event) {
  return getParsedContent(event, undefined, undefined, CommentContentSymbol);
}
