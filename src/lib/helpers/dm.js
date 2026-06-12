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
