/**
 * DM trust classification (pure helpers).
 *
 * Splits the DM conversation list into "known" (main list) and "requests"
 * (strangers) and drops muted senders entirely. A conversation is known when
 * any peer is followed, has been replied to, or is a deployment-trusted
 * sender — or when it is a note-to-self thread. Muted words additionally drop
 * request conversations (strangers only, never known contacts), which is what
 * catches a spam campaign that rotates pubkeys faster than a user can block
 * them. Display-side only: relay subscriptions stay untouched so no message is
 * ever lost, just re-shelved.
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
 * @template {{ participants: string[], lastMessage?: { content?: string, [k: string]: any } }} T
 * @param {T[]} conversations
 * @param {{
 *   selfPubkey: string,
 *   follows: Set<string>,
 *   mutedPubkeys: Set<string>,
 *   outboundPeers: Set<string>,
 *   trustedSenders: Set<string>,
 *   mutedWords?: Set<string>
 * }} opts
 * @returns {{ known: T[], requests: T[] }}
 */
export function classifyDmConversations(conversations, opts) {
  const { selfPubkey, follows, mutedPubkeys, outboundPeers, trustedSenders, mutedWords } = opts;
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
    if (isKnown) {
      known.push(conv);
      continue;
    }
    // Muted words apply to strangers only — a campaign that rotates pubkeys
    // outruns per-pubkey blocking, while a known contact must never vanish for
    // quoting a muted word. Undecrypted content can't match and stays shelved.
    if (matchesMutedWord(conv.lastMessage?.content, mutedWords)) continue;
    requests.push(conv);
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

/**
 * Case-insensitive substring match against NIP-51 muted words. Substring (not
 * word-boundary) matching lets a single entry like "damus airdrop" catch a
 * whole campaign across rotating pubkeys, domains, and phrasings.
 * @param {string | undefined} content
 * @param {Set<string> | undefined} mutedWords - stored lowercase (normalized on parse)
 * @returns {boolean}
 */
export function matchesMutedWord(content, mutedWords) {
  if (!content || !mutedWords || mutedWords.size === 0) return false;
  const haystack = content.toLowerCase();
  for (const word of mutedWords) {
    if (word && haystack.includes(word)) return true;
  }
  return false;
}

/**
 * Drop events authored by muted pubkeys or whose content matches a muted
 * word. Returns the input array unchanged (same reference) when nothing is
 * muted, so reactive consumers don't churn.
 * @template {{ pubkey: string, content?: string }} T
 * @param {T[]} events
 * @param {Set<string>} mutedPubkeys
 * @param {Set<string>} mutedWords
 * @returns {T[]}
 */
export function excludeMuted(events, mutedPubkeys, mutedWords) {
  const hasPubkeys = mutedPubkeys && mutedPubkeys.size > 0;
  const hasWords = mutedWords && mutedWords.size > 0;
  if (!hasPubkeys && !hasWords) return events;
  return events.filter(
    (e) => !(hasPubkeys && mutedPubkeys.has(e.pubkey)) && !matchesMutedWord(e.content, mutedWords)
  );
}
