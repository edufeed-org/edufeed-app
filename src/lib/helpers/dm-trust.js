/**
 * DM trust classification (pure helpers).
 *
 * Splits the DM conversation list into "known" (main list) and "requests"
 * (strangers) and drops muted senders entirely. A conversation is known when
 * any peer is followed, has been replied to, or is a deployment-trusted
 * sender — or when it is a note-to-self thread. Display-side only: relay
 * subscriptions stay untouched so no message is ever lost, just re-shelved.
 */

/**
 * All participants of a conversation except the active user.
 * @param {string[]} participants
 * @param {string} selfPubkey
 * @returns {string[]}
 */
export function getConversationPeers(participants, selfPubkey) {
  return (participants || []).filter((p) => p !== selfPubkey);
}

/**
 * @template {{ participants: string[] }} T
 * @param {T[]} conversations
 * @param {{
 *   selfPubkey: string,
 *   follows: Set<string>,
 *   mutedPubkeys: Set<string>,
 *   outboundPeers: Set<string>,
 *   trustedSenders: Set<string>
 * }} opts
 * @returns {{ known: T[], requests: T[] }}
 */
export function classifyDmConversations(conversations, opts) {
  const { selfPubkey, follows, mutedPubkeys, outboundPeers, trustedSenders } = opts;
  /** @type {T[]} */
  const known = [];
  /** @type {T[]} */
  const requests = [];

  for (const conv of conversations || []) {
    const peers = getConversationPeers(conv.participants, selfPubkey);
    // Note-to-self threads have no peers and are always known.
    if (peers.length === 0) {
      known.push(conv);
      continue;
    }
    const unmuted = peers.filter((p) => !mutedPubkeys.has(p));
    if (unmuted.length === 0) continue; // every peer muted — drop entirely
    const isKnown = unmuted.some(
      (p) => follows.has(p) || outboundPeers.has(p) || trustedSenders.has(p)
    );
    (isKnown ? known : requests).push(conv);
  }

  return { known, requests };
}

/**
 * Drop events authored by muted pubkeys. Returns the input array unchanged
 * (same reference) when nothing is muted, so reactive consumers don't churn.
 * @template {{ pubkey: string }} T
 * @param {T[]} events
 * @param {Set<string>} mutedPubkeys
 * @returns {T[]}
 */
export function excludeMutedAuthors(events, mutedPubkeys) {
  if (!mutedPubkeys || mutedPubkeys.size === 0) return events;
  return events.filter((e) => !mutedPubkeys.has(e.pubkey));
}
