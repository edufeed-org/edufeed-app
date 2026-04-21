/**
 * Single source of truth for NIP-51 list kinds surfaced in edufeed.
 *
 * Drives:
 *   - `$lib/stores/personal-lists.svelte.js` (loader filters, subscription shape)
 *   - `$lib/components/lists/ListCard.svelte` (which render mode to use)
 *   - `$lib/components/lists/ListItemEditor.svelte` (allowed tag types, validators)
 *   - `$lib/components/dashboard/DashboardLists.svelte` (iteration order)
 *
 * Adding a new list kind should only require adding a row here plus (optionally)
 * one i18n key — no per-kind store, no per-kind render block.
 *
 * Each entry:
 *   key       - stable identifier used for i18n keys and data-testids
 *   singleton - true for replaceable (one per user), false for addressable/parameterized
 *   itemTag   - single allowed tag name (convenience when there's just one)
 *   itemTags  - array of allowed tag names (use when multiple)
 *   render    - render mode string consumed by ListCard snippets
 *                 'people'     — p-tag profile chips
 *                 'events'     — e/a-pointer event cards
 *                 'addresses'  — a-tag coordinates (community/addressable refs)
 *                 'relays'     — relay URL list
 *                 'relays-rw'  — NIP-65 relay list with read/write markers
 *                 'tags'       — hashtag pills (t-tags)
 *                 'emoji'      — emoji shortcode + image grid
 *                 'mute'       — mute-list breakdown (pubkeys / hashtags / words / threads)
 *   hidden    - whether hidden (encrypted) tags are meaningful for this kind
 *                 See applesauce-core/helpers `canHaveHiddenTags`.
 */
import * as kinds from 'nostr-tools/kinds';

/** @typedef {'people'|'events'|'addresses'|'relays'|'relays-rw'|'tags'|'emoji'|'mute'} ListRenderMode */

/**
 * @typedef {Object} ListKindSpec
 * @property {string} key
 * @property {boolean} singleton
 * @property {string} [itemTag]
 * @property {string[]} [itemTags]
 * @property {ListRenderMode} render
 * @property {boolean} hidden
 */

/** Starter Pack (NIP-51) — no constant in nostr-tools yet. */
export const STARTER_PACK_KIND = 39089;

/** @type {Record<number, ListKindSpec>} */
export const LIST_KINDS = {
  // --- Standard (replaceable, one per user) ---
  [kinds.Contacts]: {
    key: 'contacts',
    singleton: true,
    itemTag: 'p',
    render: 'people',
    hidden: false
  },
  [kinds.Mutelist]: {
    key: 'mute',
    singleton: true,
    itemTags: ['p', 't', 'word', 'e'],
    render: 'mute',
    hidden: true
  },
  [kinds.Pinlist]: {
    key: 'pinned',
    singleton: true,
    itemTag: 'e',
    render: 'events',
    hidden: false
  },
  [kinds.RelayList]: {
    key: 'relays',
    singleton: true,
    itemTag: 'r',
    render: 'relays-rw',
    hidden: false
  },
  [kinds.BookmarkList]: {
    key: 'bookmarks',
    singleton: true,
    itemTags: ['e', 'a', 't', 'r'],
    render: 'events',
    hidden: true
  },
  [kinds.CommunitiesList]: {
    key: 'communities',
    singleton: true,
    itemTag: 'a',
    render: 'addresses',
    hidden: true
  },
  [kinds.PublicChatsList]: {
    key: 'public_chats',
    singleton: true,
    itemTag: 'e',
    render: 'events',
    hidden: true
  },
  [kinds.BlockedRelaysList]: {
    key: 'blocked_relays',
    singleton: true,
    itemTag: 'relay',
    render: 'relays',
    hidden: false
  },
  [kinds.SearchRelaysList]: {
    key: 'search_relays',
    singleton: true,
    itemTag: 'relay',
    render: 'relays',
    hidden: false
  },
  [kinds.InterestsList]: {
    key: 'interests',
    singleton: true,
    itemTag: 't',
    render: 'tags',
    hidden: false
  },
  [kinds.UserEmojiList]: {
    key: 'emoji',
    singleton: true,
    itemTags: ['emoji', 'a'],
    render: 'emoji',
    hidden: false
  },
  [kinds.DirectMessageRelaysList]: {
    key: 'dm_relays',
    singleton: true,
    itemTag: 'relay',
    render: 'relays',
    hidden: false
  },

  // --- Parameterised (addressable, multiple per user, identified by d-tag) ---
  [kinds.Followsets]: {
    key: 'follow_set',
    singleton: false,
    itemTag: 'p',
    render: 'people',
    hidden: true
  },
  [kinds.Relaysets]: {
    key: 'relay_set',
    singleton: false,
    itemTag: 'relay',
    render: 'relays',
    hidden: true
  },
  [kinds.Bookmarksets]: {
    key: 'bookmark_set',
    singleton: false,
    itemTags: ['e', 'a', 't', 'r'],
    render: 'events',
    hidden: true
  },
  [kinds.Curationsets]: {
    key: 'curation_set',
    singleton: false,
    itemTags: ['a', 'e'],
    render: 'events',
    hidden: true
  },
  [kinds.Interestsets]: {
    key: 'interest_set',
    singleton: false,
    itemTag: 't',
    render: 'tags',
    hidden: false
  },
  [kinds.Emojisets]: {
    key: 'emoji_set',
    singleton: false,
    itemTag: 'emoji',
    render: 'emoji',
    hidden: false
  },
  [STARTER_PACK_KIND]: {
    key: 'starter_pack',
    singleton: false,
    itemTag: 'p',
    render: 'people',
    hidden: false
  }
};

/** Replaceable, non-parameterised list kinds (< 20000). */
export const STANDARD_LIST_KINDS = Object.keys(LIST_KINDS)
  .map(Number)
  .filter((k) => k < 20000);

/** Addressable (parameterised) list kinds (>= 30000). */
export const PARAMETERIZED_LIST_KINDS = Object.keys(LIST_KINDS)
  .map(Number)
  .filter((k) => k >= 30000);

/**
 * Lookup a kind's metadata. Returns `undefined` for unsupported kinds so
 * callers can fall back to a generic "unknown list" display.
 * @param {number} kind
 * @returns {ListKindSpec | undefined}
 */
export function getListKindSpec(kind) {
  return LIST_KINDS[kind];
}
