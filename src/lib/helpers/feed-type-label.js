/**
 * Visible label of a feed card type (`getFeedCardData(...).typeKey`) — the
 * badge on FeedCard and the type chips of a list's filter. Static message
 * calls on purpose: indexing the Paraglide namespace by a runtime key pins
 * every message into one chunk (see CLAUDE.md, Root Layout Import Budget).
 */
import * as m from '$lib/paraglide/messages';

/**
 * @param {string} typeKey
 * @returns {string} '' for an unknown type
 */
export function feedTypeLabel(typeKey) {
  switch (typeKey) {
    case 'calendar':
      return m.feed_badge_calendar();
    case 'learning':
      return m.feed_badge_learning();
    case 'article':
      return m.feed_badge_article();
    case 'board':
      return m.feed_badge_board();
    case 'wiki':
      return m.feed_badge_wiki();
    case 'thread':
      return m.feed_badge_thread();
    case 'bookmark':
      return m.feed_badge_bookmark();
    case 'highlight':
      return m.feed_badge_highlight();
    case 'note':
      return m.feed_badge_note();
    case 'page-note':
      return m.feed_badge_page_note();
    case 'reply':
      return m.feed_badge_reply();
    case 'form':
      return m.feed_badge_form();
    case 'poll':
      return m.feed_badge_poll();
    default:
      return '';
  }
}
