/**
 * DM (Direct Message) helpers.
 * Pure functions for DM relay resolution and read state tracking.
 */

export const DM_READ_TIMESTAMPS_KEY = 'comcal:dm:read-timestamps';

/**
 * Extract relay URLs from a kind 10050 DM relay list event.
 * @param {any} event
 * @returns {string[]}
 */
export function getDmRelaysFromEvent(event) {
  if (!event) return [];
  return event.tags
    .filter((/** @type {string[]} */ t) => t[0] === 'relay' && t[1])
    .map((/** @type {string[]} */ t) => t[1]);
}

/**
 * Build an unsigned kind 10050 DM relay list event (NIP-17).
 * @param {string} pubkey
 * @param {string[]} relays
 * @returns {{kind: number, created_at: number, tags: string[][], content: string, pubkey: string}}
 */
export function buildDmRelayListEvent(pubkey, relays) {
  return {
    kind: 10050,
    created_at: Math.floor(Date.now() / 1000),
    tags: relays.map((url) => ['relay', url]),
    content: '',
    pubkey
  };
}

/**
 * Load per-conversation read timestamps from localStorage.
 * @param {string} pubkey
 * @returns {Record<string, number>}
 */
export function loadReadTimestamps(pubkey) {
  try {
    const raw = localStorage.getItem(`${DM_READ_TIMESTAMPS_KEY}:${pubkey}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save per-conversation read timestamps to localStorage.
 * @param {string} pubkey
 * @param {Record<string, number>} timestamps
 */
export function saveReadTimestamps(pubkey, timestamps) {
  localStorage.setItem(`${DM_READ_TIMESTAMPS_KEY}:${pubkey}`, JSON.stringify(timestamps));
}

/**
 * Check if a conversation has unread messages.
 * @param {string} conversationId
 * @param {number} lastMessageTimestamp
 * @param {Record<string, number>} readTimestamps
 * @returns {boolean}
 */
export function isConversationUnread(conversationId, lastMessageTimestamp, readTimestamps) {
  const lastRead = readTimestamps[conversationId];
  if (lastRead === undefined) return true;
  return lastMessageTimestamp > lastRead;
}

// --- Legacy (NIP-04, kind 4) DM interop ---
//
// Edufeed sends NIP-17 gift wraps, but other clients (e.g. Primal) still send
// legacy NIP-04 kind-4 DMs. We surface those read-only and clearly marked as
// insecure. A legacy conversation shares the same correspondent identifier as a
// hypothetical wrapped one, so we namespace its conversation id with this prefix
// to keep the two threads distinct in the list and to let ConversationThread
// pick the right applesauce model.

/** Conversation-id prefix marking a legacy (NIP-04) thread. */
export const LEGACY_CONVERSATION_PREFIX = 'legacy:';

/**
 * @param {string} baseId
 * @returns {string}
 */
export function toLegacyConversationId(baseId) {
  return `${LEGACY_CONVERSATION_PREFIX}${baseId}`;
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isLegacyConversationId(id) {
  return typeof id === 'string' && id.startsWith(LEGACY_CONVERSATION_PREFIX);
}

/**
 * Remove the legacy prefix. No-op for non-legacy ids.
 * @param {string} id
 * @returns {string}
 */
export function stripLegacyConversationId(id) {
  return isLegacyConversationId(id) ? id.slice(LEGACY_CONVERSATION_PREFIX.length) : id;
}

/**
 * Normalize a raw legacy conversation (from applesauce LegacyMessagesGroups)
 * into the shape the DM UI expects: a `legacy:`-prefixed id, a `legacy` flag,
 * and a lastMessage whose `content` is the decrypted plaintext (the raw event's
 * `content` is ciphertext).
 * @param {{id: string, participants: string[], lastMessage: any}} conv
 * @param {string} decryptedContent
 * @returns {{id: string, participants: string[], legacy: true, lastMessage: any}}
 */
export function normalizeLegacyConversation(conv, decryptedContent) {
  return {
    id: toLegacyConversationId(conv.id),
    participants: conv.participants,
    legacy: true,
    lastMessage: { ...conv.lastMessage, content: decryptedContent }
  };
}

/**
 * Normalize a legacy kind-4 event into a message object whose `content` is the
 * decrypted plaintext, so content renderers (which read `.content`) work.
 * `decryptFailed` distinguishes a message whose NIP-04 decrypt threw (render a
 * placeholder) from one still pending or genuinely empty (render nothing).
 * @param {any} event
 * @param {string} decryptedContent
 * @param {boolean} [decryptFailed]
 * @returns {any}
 */
export function normalizeLegacyMessage(event, decryptedContent, decryptFailed = false) {
  return { ...event, content: decryptedContent, decryptFailed };
}

/**
 * Participants of a legacy (kind-4) message: the author plus every p-tagged
 * pubkey, deduped. Mirrors applesauce `getConversationParticipants` for kind 4.
 * @param {any} message
 * @returns {string[]}
 */
function legacyMessageParticipants(message) {
  const list = [
    message.pubkey,
    ...(message.tags || [])
      .filter((/** @type {string[]} */ t) => t[0] === 'p')
      .map((/** @type {string[]} */ t) => t[1])
  ];
  return [...new Set(list)];
}

/**
 * Conversation identifier for a legacy message: sorted unique participants
 * joined by ':'. Inbound and outbound messages of the same 1:1 thread produce
 * the same id. Mirrors applesauce `getConversationIdentifierFromMessage`.
 * @param {any} message
 * @returns {string}
 */
function legacyConversationIdentifier(message) {
  return [...legacyMessageParticipants(message)].sort().join(':');
}

/**
 * Group a flat list of legacy (kind-4) events — both inbound (`#p=self`) and
 * outbound (authored by self) — into 1:1 conversations, keyed by sorted
 * participant identifier, with the newest event as `lastMessage`.
 *
 * The applesauce `LegacyMessagesGroups` model only indexes inbound messages, so
 * on its own the conversation list neither shows threads you started nor
 * reflects your own latest reply. Grouping both directions here keeps the
 * preview text, timestamp, and ordering correct for sent messages.
 * @param {any[]} [messages]
 * @returns {{ id: string, participants: string[], lastMessage: any }[]}
 */
export function groupLegacyConversations(messages) {
  /** @type {Record<string, any>} */
  const groups = {};
  for (const message of messages || []) {
    const id = legacyConversationIdentifier(message);
    if (!groups[id] || groups[id].created_at < message.created_at) groups[id] = message;
  }
  return Object.values(groups).map((message) => ({
    id: legacyConversationIdentifier(message),
    participants: legacyMessageParticipants(message),
    lastMessage: message
  }));
}

/**
 * Merge wrapped (NIP-17) and legacy (NIP-04) conversations into one list sorted
 * by most-recent message first.
 * @param {any[]} [wrapped]
 * @param {any[]} [legacy]
 * @returns {any[]}
 */
export function mergeDmConversations(wrapped, legacy) {
  return [...(wrapped || []), ...(legacy || [])].sort(
    (a, b) => (b.lastMessage?.created_at || 0) - (a.lastMessage?.created_at || 0)
  );
}
