// NIP-29's spec-native membership application: a bare kind-9021 join request
// (content = optional free-text reason) is STORED by the relay for a closed
// group — verified live against groups.0xchat.com — and an admin completes
// it with kind-9000 put-user. This module shapes the stored 9021s into the
// admin queue MembershipPane renders ("Beitrittsanfragen"); no custom kinds,
// unlike the removed Beitrittsformular layer.

/**
 * @typedef {{id: string, pubkey: string, reason: string, createdAt: number}} JoinRequestRow
 */

/**
 * Newest pending request per applicant, sorted newest first.
 *
 * - Roster members (and admins — pass their pubkeys in `members` too if
 *   they're not in it) are dropped: approving via put-user empties the queue
 *   without any extra bookkeeping.
 * - `dismissed` holds locally ignored REQUEST ids (not pubkeys), so a newer
 *   re-request from an ignored applicant resurfaces — same rule as the old
 *   approvals panel's rejectedIds.
 *
 * @param {{
 *   events: Array<{id?: string, kind?: number, pubkey?: string, created_at?: number, content?: string} | null>,
 *   members: Set<string>,
 *   dismissed: Set<string>
 * }} args
 * @returns {JoinRequestRow[]}
 */
export function pendingJoinRequests({ events, members, dismissed }) {
  /** @type {Map<string, JoinRequestRow>} */
  const newestByPubkey = new Map();
  for (const event of events ?? []) {
    if (!event || event.kind !== 9021) continue;
    const { id, pubkey, created_at: createdAt } = event;
    if (typeof id !== 'string' || typeof pubkey !== 'string' || typeof createdAt !== 'number') {
      continue;
    }
    if (members.has(pubkey)) continue;
    const current = newestByPubkey.get(pubkey);
    if (current && current.createdAt >= createdAt) continue;
    newestByPubkey.set(pubkey, {
      id,
      pubkey,
      reason: typeof event.content === 'string' ? event.content : '',
      createdAt
    });
  }
  return [...newestByPubkey.values()]
    .filter((row) => !dismissed.has(row.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * localStorage key for a community's dismissed join-request ids.
 * @param {string} communityId
 */
export function dismissedJoinRequestsKey(communityId) {
  return `groups/join-requests/dismissed/${communityId}`;
}

/** @param {string} communityId @returns {Set<string>} */
export function readDismissedJoinRequests(communityId) {
  try {
    const raw = localStorage.getItem(dismissedJoinRequestsKey(communityId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** @param {string} communityId @param {Set<string>} ids */
export function writeDismissedJoinRequests(communityId, ids) {
  try {
    localStorage.setItem(dismissedJoinRequestsKey(communityId), JSON.stringify([...ids]));
  } catch {
    // Quota/privacy-mode failures degrade to session-only dismissal.
  }
}
