// Pure derivation: turn a relay subtree's kind:39000 events into a community's
// channel list. A community is one ROOT group plus the channel subgroups that
// point at it with ["parent", rootId]; the per-community /c/<rootId> endpoint
// serves exactly that subtree (see community-channels.svelte.js and the pyramid
// fork's groups/virtual.go). Channels are DISCOVERED here from the relay, not
// read from a kind-10222 `group` pointer — which is what lets a 39001 admin who
// is not the community key-holder add a channel (no owner-signed 10222 edit).
//
// Access is the relay-observable split only: not-`private` = world, `private` =
// invited (channelAccessLevel). The retired "members" tier lived on the dropped
// pointer marker; "all community members, privately" is Concord's job now.
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { channelAccessLevel } from './channel-access.js';

/** @param {any} event @returns {string | undefined} the `d` tag (group id) */
export function dTagOf(event) {
  return event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
}

/** @param {any} event @returns {string | undefined} the `parent` tag (root id), if any */
export function parentOf(event) {
  return event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'parent')?.[1];
}

/** @param {any} event @returns {string | undefined} the `name` tag */
export function nameOf(event) {
  return event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'name')?.[1];
}

/**
 * @typedef {{
 *   id: string,
 *   relay: string,
 *   name: string | undefined,
 *   level: import('./channel-access.js').ChannelAccessLevel,
 *   metadata: any
 * }} SubtreeChannel
 */

/**
 * Build the community's channel list from a bag of kind:39000 events (as the
 * /c/<rootId> endpoint delivers them into the eventStore — which may also hold
 * OTHER communities' 39000s, so we filter by rootId here).
 *
 * @param {any[]} events   kind:39000 events (unrelated communities' allowed)
 * @param {string} rootId  the community root group id
 * @param {string} relay   endpoint URL stamped on each row (channelKey/addressing)
 * @param {boolean} [hostRequiresAuth] caps a not-private channel down when the
 *   host gates every read behind NIP-42 (see channelAccessLevel)
 * @returns {{ root: SubtreeChannel | null, channels: SubtreeChannel[] }}
 */
export function buildSubtreeChannels(events, rootId, relay, hostRequiresAuth = false) {
  if (!rootId || !Array.isArray(events)) return { root: null, channels: [] };

  /** @type {Map<string, any>} newest 39000 per child id */
  const newestById = new Map();
  /** @type {any} */
  let rootEvent = null;

  for (const ev of events) {
    if (!ev || ev.kind !== GROUP_METADATA_KIND) continue;
    const id = dTagOf(ev);
    if (!id) continue;
    if (id === rootId) {
      if (!rootEvent || ev.created_at > rootEvent.created_at) rootEvent = ev;
      continue;
    }
    // A channel of THIS community iff its parent points at our root. One level
    // deep, matching the endpoint's own subtree scope (groups/virtual.go).
    if (parentOf(ev) !== rootId) continue;
    const prev = newestById.get(id);
    if (!prev || ev.created_at > prev.created_at) newestById.set(id, ev);
  }

  /** @param {any} ev @returns {SubtreeChannel} */
  const toRow = (ev) => ({
    id: /** @type {string} */ (dTagOf(ev)),
    relay,
    name: nameOf(ev),
    level: channelAccessLevel(ev, undefined, hostRequiresAuth),
    metadata: ev
  });

  const channels = [...newestById.values()]
    .map(toRow)
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

  return { root: rootEvent ? toRow(rootEvent) : null, channels };
}
