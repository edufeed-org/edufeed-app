// NIP-29's spec-native membership application: a bare kind-9021 join request
// (content = optional free-text reason) is STORED by the relay for a closed
// group — verified live against groups.0xchat.com — and an admin completes
// it with kind-9000 put-user. This module shapes the stored 9021s into the
// admin queue MembershipPane renders ("Beitrittsanfragen"); no custom kinds,
// unlike the removed Beitrittsformular layer.

/**
 * @typedef {{id: string, pubkey: string, reason: string, createdAt: number, groupId: string}} JoinRequestRow
 */

/**
 * A group's known roster from `membersByGroup`, tolerating either a Map or a
 * plain record — whichever shape a caller finds more natural to build.
 * `undefined` means "roster unknown", distinct from an empty-but-known Set.
 * @param {Map<string, Set<string>> | Record<string, Set<string>> | undefined | null} membersByGroup
 * @param {string} groupId
 * @returns {Set<string> | undefined}
 */
function rosterOf(membersByGroup, groupId) {
  if (!membersByGroup) return undefined;
  if (membersByGroup instanceof Map) return membersByGroup.get(groupId);
  return membersByGroup[groupId];
}

/**
 * Newest pending request per (applicant, group knocked on), sorted newest
 * first.
 *
 * - A request is dropped ONLY when the applicant is already a KNOWN member
 *   of the exact group they knocked on (`membersByGroup.get(row.groupId)`,
 *   falling back to `rootId` when the 9021 carried no `h` tag). A group
 *   whose roster hasn't been resolved yet (no entry in `membersByGroup`) is
 *   treated as "requester not a member" — showing an extra row a moment
 *   longer is the safe direction, silently dropping a real request is not.
 *   This is what makes an existing community member's knock on a closed
 *   CHANNEL visible: their root membership does not clear the channel's own
 *   roster check.
 * - `dismissed` holds locally ignored REQUEST ids (not pubkeys), so a newer
 *   re-request from an ignored applicant resurfaces — same rule as the old
 *   approvals panel's rejectedIds.
 *
 * @param {{
 *   events: Array<{id?: string, kind?: number, pubkey?: string, created_at?: number, content?: string} | null>,
 *   membersByGroup: Map<string, Set<string>> | Record<string, Set<string>>,
 *   rootId: string,
 *   dismissed: Set<string>
 * }} args
 * @returns {JoinRequestRow[]}
 */
export function pendingJoinRequests({ events, membersByGroup, rootId, dismissed }) {
  /** @type {Map<string, JoinRequestRow>} */
  const newestByKey = new Map();
  for (const event of events ?? []) {
    if (!event || event.kind !== 9021) continue;
    const { id, pubkey, created_at: createdAt } = event;
    if (typeof id !== 'string' || typeof pubkey !== 'string' || typeof createdAt !== 'number') {
      continue;
    }
    // Which group the applicant knocked on (root or a channel) — a missing
    // h-tag falls back to the root group, both for display and for the
    // membership check below.
    const hTag = /** @type {any} */ (event).tags?.find(
      (/** @type {string[]} */ t) => Array.isArray(t) && t[0] === 'h'
    )?.[1];
    const groupId = typeof hTag === 'string' && hTag ? hTag : (rootId ?? '');
    const roster = rosterOf(membersByGroup, groupId);
    if (roster && roster.has(pubkey)) continue;
    // Per-(pubkey, group): a member's channel ask must not be shadowed by
    // their older root request and vice versa.
    const key = `${pubkey}\x1f${groupId}`;
    const current = newestByKey.get(key);
    if (current && current.createdAt >= createdAt) continue;
    newestByKey.set(key, {
      id,
      pubkey,
      reason: typeof event.content === 'string' ? event.content : '',
      createdAt,
      groupId
    });
  }
  return [...newestByKey.values()]
    .filter((row) => !dismissed.has(row.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

const DISMISSED_KEY_PREFIX = 'groups/join-requests/dismissed/';

/**
 * Same-tab signal that a dismissed set changed. localStorage 'storage' events
 * only fire in OTHER tabs, so the global alert hook (join-request-alerts)
 * would miss an "Ignorieren" done in the members page of this very tab
 * without it.
 */
export const JOIN_REQUESTS_DISMISSED_EVENT = 'edufeed:join-requests-dismissed';

/**
 * localStorage key for a community's dismissed join-request ids.
 * @param {string} communityId
 */
export function dismissedJoinRequestsKey(communityId) {
  return `${DISMISSED_KEY_PREFIX}${communityId}`;
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
    window.dispatchEvent(new CustomEvent(JOIN_REQUESTS_DISMISSED_EVENT));
  } catch {
    // Quota/privacy-mode failures degrade to session-only dismissal.
  }
}

/**
 * Union of EVERY community's dismissed request ids. The global alert hook
 * works with group ids, not community ids, so it cannot pick one per-community
 * set — but an id dismissed anywhere must not keep the alert badge alive.
 * @returns {Set<string>}
 */
export function readAllDismissedJoinRequests() {
  /** @type {Set<string>} */
  const all = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DISMISSED_KEY_PREFIX)) continue;
      for (const id of readDismissedJoinRequests(key.slice(DISMISSED_KEY_PREFIX.length))) {
        all.add(id);
      }
    }
  } catch {
    // localStorage unavailable — nothing is dismissed.
  }
  return all;
}
