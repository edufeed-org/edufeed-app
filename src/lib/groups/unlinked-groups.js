// Which of the user's NIP-29 groups still belong in the sidebar.
//
// The exact rule Concord already follows for its areas
// (concord/unlinked-areas.js): a room reachable through a community page must
// NOT also sit loose in the sidebar, or the same room shows up twice under two
// different names. What is left over — a group joined from another client, or
// by pasting an address — has no other home, so the sidebar is it.
//
// Pure. The reactive plumbing (whose 10222s, whose 10009, which kind:39000)
// lives in unlinked-groups.svelte.js.
import { parseGroupPointers, channelKey } from './community-pointer.js';
import { channelAccessLevel, channelGlyph } from './channel-access.js';

/**
 * @typedef {{
 *   key: string,
 *   name: string,
 *   symbol: string,
 *   worldReadable: boolean,
 *   pointer: {id: string, relay: string}
 * }} UnlinkedGroup
 */

/**
 * Every channel pointer the given communities already claim, as channelKeys.
 * Pure: it only reflects the 10222 events the caller passed in.
 * @param {any[] | null | undefined} communikeyEvents kind 10222 events
 * @returns {Set<string>}
 */
export function linkedChannelKeys(communikeyEvents) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const event of communikeyEvents ?? []) {
    for (const pointer of parseGroupPointers(event)) {
      const key = channelKey(pointer);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/**
 * A single-value `name` tag off an untrusted kind:39000 metadata event.
 * Whitespace-only counts as absent — a group that writes `["name", "  "]`
 * has said nothing, and a row must fall back to the id rather than draw
 * blank. Shared by unlinkedGroups here and groupAttachCandidates
 * (attach-candidates.js) — was two near-identical private copies.
 * @param {{tags?: string[][]} | null | undefined} metadata
 * @returns {string | undefined}
 */
export function metadataName(metadata) {
  return (metadata?.tags ?? []).find((t) => t[0] === 'name' && t[1]?.trim())?.[1]?.trim();
}

/**
 * @typedef {{
 *   key: string,
 *   name: string,
 *   level: import('./channel-access.js').ChannelAccessLevel,
 *   pointer: {id: string, relay: string}
 * }} GroupCandidateEntry
 */

/**
 * The shared shaping behind both unlinkedGroups (sidebar) and
 * groupAttachCandidates (attach-candidates.js): dedupe by channelKey, drop
 * excluded and unaddressable pointers, resolve a display name + access level
 * off `metadataByKey`, sort by the name a reader actually sees. Was two
 * near-identical loops — this is the part that was identical; each caller
 * still decides how `level` becomes ITS OWN presentation fields (glyph vs.
 * category label), which is where the two callers genuinely differ.
 * @param {{
 *   groups?: Array<{id: string, relay: string}> | null,
 *   excludeKeys?: Set<string> | null,
 *   metadataByKey?: Record<string, {kind?: number, tags?: string[][]}>
 * }} input
 * @returns {GroupCandidateEntry[]} sorted by the name a reader actually sees
 */
export function groupCandidateEntries({ groups, excludeKeys, metadataByKey = {} }) {
  /** @type {Map<string, GroupCandidateEntry>} */
  const byKey = new Map();
  for (const group of groups ?? []) {
    const key = channelKey(group);
    // Unaddressable entries are dropped rather than drawn: a row that cannot
    // link anywhere is worse than an absent one.
    if (!key || excludeKeys?.has(key) || byKey.has(key)) continue;
    const metadata = metadataByKey[key];
    byKey.set(key, {
      key,
      name: metadataName(metadata) || group.id,
      level: channelAccessLevel(metadata, undefined),
      pointer: { id: group.id, relay: group.relay }
    });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * The user's groups that no followed community shows as a channel.
 *
 * `metadataByKey` is the same map the community rail builds
 * (groups/channel-metadata.svelte.js) — reused rather than refetched, because
 * the kind-10009 list carries only id and relay, and the readable name lives
 * in each group's own kind:39000.
 *
 * @param {{
 *   groups?: Array<{id: string, relay: string}> | null,
 *   linkedKeys?: Set<string> | null,
 *   metadataByKey?: Record<string, {kind?: number, tags?: string[][]}>
 * }} input
 * @returns {UnlinkedGroup[]} sorted by the name a reader actually sees
 */
export function unlinkedGroups({ groups, linkedKeys, metadataByKey = {} }) {
  // Same rule and same glyph as the community rail. No community claims
  // this group, so there is no access marker to read: the relay's `private`
  // is the only signal, and its absence is what makes a row world-readable.
  return groupCandidateEntries({ groups, excludeKeys: linkedKeys, metadataByKey }).map((entry) => {
    const glyph = channelGlyph(entry.level);
    return {
      key: entry.key,
      name: entry.name,
      symbol: glyph.symbol,
      worldReadable: glyph.worldReadable,
      pointer: entry.pointer
    };
  });
}
