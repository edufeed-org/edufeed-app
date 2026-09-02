// NIP-29's spec-native membership application: a bare kind-9021 join request
// (content = optional free-text reason) is STORED by the relay for a closed
// group — verified live against groups.0xchat.com — and an admin completes
// it with kind-9000 put-user. This module shapes the stored 9021s into the
// admin queue MembershipPane renders ("Beitrittsanfragen"); no custom kinds,
// unlike the removed Beitrittsformular layer.

/**
 * One queue row per APPLICANT — their surviving asks merged, newest first.
 * `id`/`createdAt`/`reason` come from the newest ask (reason: newest
 * non-empty); `ids` carries every underlying request id (the dismissal
 * targets), `groupIds` every group knocked on.
 * @typedef {{id: string, ids: string[], pubkey: string, reason: string, createdAt: number, groupIds: string[]}} JoinRequestRow
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
 * Pending requests grouped ONE ROW PER APPLICANT (dedupe fix: a user whose
 * retries or channel asks produced several 9021s must not fill the queue
 * with one row each), sorted newest first. Internally still deduped to the
 * newest request per (applicant, group knocked on) before grouping.
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
  /** @type {Map<string, {id: string, pubkey: string, reason: string, createdAt: number, groupId: string}>} */
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
  // Surviving asks, newest first, then merged into one row per applicant —
  // insertion order into rowByPubkey makes each row's ids/groupIds
  // newest-first and its id/createdAt the newest ask's for free. Dismissal
  // stays per REQUEST id: ignoring an ask never hides a sibling ask, and a
  // newer re-request still resurfaces.
  const surviving = [...newestByKey.values()]
    .filter((ask) => !dismissed.has(ask.id))
    .sort((a, b) => b.createdAt - a.createdAt);
  /** @type {Map<string, JoinRequestRow>} */
  const rowByPubkey = new Map();
  for (const ask of surviving) {
    const row = rowByPubkey.get(ask.pubkey);
    if (!row) {
      rowByPubkey.set(ask.pubkey, {
        id: ask.id,
        ids: [ask.id],
        pubkey: ask.pubkey,
        reason: ask.reason,
        createdAt: ask.createdAt,
        groupIds: [ask.groupId]
      });
      continue;
    }
    row.ids.push(ask.id);
    row.groupIds.push(ask.groupId);
    if (!row.reason) row.reason = ask.reason;
  }
  return [...rowByPubkey.values()];
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
