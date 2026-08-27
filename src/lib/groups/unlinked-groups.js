// Which of the user's NIP-29 groups still belong in the sidebar.
//
// The exact rule Concord already follows for its areas
// (concord/unlinked-areas.js): a room reachable through a community page must
// NOT also sit loose in the sidebar, or the same room shows up twice under two
// different names. What is left over — a group joined from another client, or
// by pasting an address — has no other home, so the sidebar is it.
//
// Two rules answer "already reachable through a community": the 10222's own
// `group` pointers (linkedChannelKeys, legacy communities) and the address
// shape (isCommunityEndpoint, everything created since channels moved to
// subtree discovery). Communities stopped writing pointers, so the second rule
// is the one that carries — see its docblock.
//
// Pure. The reactive plumbing (whose 10222s, whose 10009, which kind:39000)
// lives in unlinked-groups.svelte.js.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { parseGroupPointers, channelKey } from './community-pointer.js';
import { channelAccessLevel, channelGlyph } from './channel-access.js';
import { flatGroupsRelay } from './community-endpoint.js';

/**
 * @typedef {{
 *   key: string,
 *   name: string,
 *   symbol: string,
 *   worldReadable: boolean,
 *   locked: boolean,
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
 * Whether this relay URL addresses ONE community's subtree
 * (`wss://host/c/<rootId>`) rather than a bare NIP-29 host.
 *
 * The second exclusion rule, and by now the load-bearing one. `linkedChannelKeys`
 * asks the 10222 which channels it claims — but a community stopped claiming
 * them: since 8d03f873 channels are DISCOVERED from the relay subtree and
 * ChannelCreateWizard writes no `group` pointer at all. So for every community
 * created since, `linkedKeys` is empty and each of its channels sitting in the
 * user's kind-10009 reads as unclaimed, drawing a relay tile for the community's
 * own endpoint beside its `/c/<npub>` entry: the same community twice, and the
 * tile is a bare host directory that cannot show content sections (laoc,
 * 2026-08-24). A channel addressed this way is by construction reachable
 * through its community, so it is never a loose row.
 *
 * Path-shape based, deliberately: the rootId in the URL is not enough to
 * resolve the community pubkey (`membership` is a multi-char tag, so no relay
 * indexes it), and `/c/<id>` is the groups relay's only path convention —
 * community-endpoint.js already rests on exactly that. The community itself is
 * kept present by the roster→follow reconcile
 * (community-follow-reconcile.svelte.js), so this never hides a channel whose
 * community has no rail entry.
 *
 * @param {string} relay
 * @returns {boolean} false for anything unparseable — a row we cannot judge
 *   stays visible rather than vanishing silently.
 */
export function isCommunityEndpoint(relay) {
  if (typeof relay !== 'string') return false;
  try {
    return flatGroupsRelay(relay) !== normalizeURL(relay);
  } catch {
    return false;
  }
}

/**
 * A single-value `name` tag off an untrusted kind:39000 metadata event.
 * Whitespace-only counts as absent — a group that writes `["name", "  "]`
 * has said nothing, and a row must fall back to the id rather than draw
 * blank. Once shared with the removed group-channel attach picker
 * (attach-candidates.js, YAGNI 2026-08-19); unlinkedGroups below is the
 * only consumer now.
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
 * The shaping behind unlinkedGroups (sidebar): dedupe by channelKey, drop
 * excluded and unaddressable pointers, resolve a display name + access level
 * off `metadataByKey`, sort by the name a reader actually sees. (Once also
 * fed the removed attach picker; the caller decides how `level` becomes
 * presentation fields — glyph vs.
 * category label), which is where the two callers genuinely differ.
 * @param {{
 *   groups?: Array<{id: string, relay: string}> | null,
 *   excludeKeys?: Set<string> | null,
 *   metadataByKey?: Record<string, {kind?: number, tags?: string[][]}>
 * }} input
 * @returns {GroupCandidateEntry[]} sorted by the name a reader actually sees
 */
function groupCandidateEntries({ groups, excludeKeys, metadataByKey = {} }) {
  /** @type {Map<string, GroupCandidateEntry>} */
  const byKey = new Map();
  for (const group of groups ?? []) {
    const key = channelKey(group);
    // Unaddressable entries are dropped rather than drawn: a row that cannot
    // link anywhere is worse than an absent one. `key` is checked first so the
    // endpoint test only ever runs on a relay URL channelKey already validated.
    if (!key || excludeKeys?.has(key) || byKey.has(key)) continue;
    if (isCommunityEndpoint(group.relay)) continue;
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
      locked: glyph.locked,
      pointer: entry.pointer
    };
  });
}
