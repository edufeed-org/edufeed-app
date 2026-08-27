// Which communities a user can SHARE into — pure half.
//
// The follow set (kind 30000, d=communities) is the public "I joined"
// signal, and share pickers used to list exactly that. But a private area's
// members deliberately never follow-set-join the linked community (the
// follow set is public; joining would leak membership) — so a publisher or
// area member had no way to share into their own community (laoc,
// 2026-08-17). Area membership is the second, private membership signal:
// any 10222 whose concord pointer names one of MY areas is a community I
// belong to, whatever the public follow set says.
//
// No applesauce-concord imports (src/lib/concord convention: pure modules
// stay dependency-free so any call site can import them SSR-safely).
import { parseConcordPointer } from './pointer.js';

/**
 * Community pubkeys whose 10222 points at one of the given areas.
 * @param {{areaIds: Set<string>, communikeyEvents: any[] | null | undefined}} args
 * @returns {string[]} deduped, in event order
 */
export function areaLinkedCommunityPubkeys({ areaIds, communikeyEvents }) {
  /** @type {string[]} */
  const out = [];
  for (const event of communikeyEvents ?? []) {
    const pointer = parseConcordPointer(event);
    if (!pointer || !areaIds.has(pointer.communityId)) continue;
    if (event?.pubkey && !out.includes(event.pubkey)) out.push(event.pubkey);
  }
  return out;
}
