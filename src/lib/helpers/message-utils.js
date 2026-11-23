/**
 * Shared message formatting utilities used by community chat and DMs.
 */
import * as m from '$lib/paraglide/messages';
import { formatDate } from '$lib/helpers/dates.js';

/**
 * Format a unix timestamp as a relative or absolute time string.
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string}
 */
export function formatMessageTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return m.message_time_now();
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return formatDate(date, { month: 'short', day: 'numeric' });
}

/**
 * Get a display name for a pubkey, with profile fallback.
 * @param {string} pubkey
 * @param {any} [profile] - Profile object with optional display_name/name fields
 * @returns {string}
 */
export function getUserDisplayName(pubkey, profile) {
  if (!pubkey) return 'Unknown';
  if (profile) {
    if (profile.display_name) return profile.display_name;
    if (profile.name) return profile.name;
  }
  return pubkey.slice(0, 8) + '...';
}

/**
 * Get the reply parent event ID from a message's NIP-10 tags.
 * @param {any} message - Event with tags array
 * @returns {string | null}
 */
export function getReplyParentId(message) {
  const eTag = message.tags?.find((/** @type {string[]} */ t) => t[0] === 'e' && t[3] === 'reply');
  return eTag?.[1] || null;
}

/**
 * Group an array of messages by date, inserting separator items.
 * Messages should already be in chronological order (oldest first).
 * @param {any[]} messages
 * @returns {Array<{ type: 'separator', date: string } | { type: 'message', message: any }>}
 */
export function groupMessagesByDate(messages) {
  /** @type {Array<{ type: 'separator', date: string } | { type: 'message', message: any }>} */
  const items = [];
  let lastDate = '';

  for (const message of messages) {
    const date = new Date(message.created_at * 1000);
    const dateStr = formatDate(date, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    if (dateStr !== lastDate) {
      items.push({ type: 'separator', date: dateStr });
      lastDate = dateStr;
    }
    items.push({ type: 'message', message });
  }
  return items;
}

/**
 * Ids of the messages that continue the previous row: same sender, at most
 * five minutes later, no date separator between. Those render without avatar
 * and name, close under the message above.
 * @param {Array<{ type: string, message?: any }>} items - groupMessagesByDate output
 * @returns {Set<string>}
 */
export function stackedMessageIds(items) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1].message;
    const cur = items[i].message;
    if (prev && cur && prev.pubkey === cur.pubkey && cur.created_at - prev.created_at <= 300)
      ids.add(cur.id);
  }
  return ids;
}
