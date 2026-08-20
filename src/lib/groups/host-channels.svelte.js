// Every channel one host has for this user, as rows a rail can render.
//
// The relay directory page and the host channel sidebar both need exactly
// this, and they must show the SAME list: a sidebar that lists nine channels
// beside a page that lists ten is worse than either alone. So the merge lives
// here once, and both surfaces read it.
//
// The three sources and the NIP-42 handling are in relay-directory.svelte.js;
// what this adds is the user's own kind-10009 narrowed to this host, and the
// turn from metadata events into rows.
//
// A plain getter, not a `$derived` — the convention every hook here follows
// (see unlinked-areas.svelte.js), and the reason matters: these are applesauce
// events from an external store, and a memoising helper writing its cache
// Symbol onto one from inside a `$derived` crashes the runtime (061c05c9).
import { buildChannelRows } from './community-channel-rows.js';
import { dTagOf, nameOf } from './subtree-channels.js';
import { channelAccessLevel } from './channel-access.js';
import { useMyGroups } from './unlinked-groups.svelte.js';
import { useRelayDirectory } from './relay-directory.svelte.js';
import { relayRequiresAuth } from './relay-directory.js';
import { useRelayInformation } from './relay-information.svelte.js';

/**
 * @param {() => string | null | undefined} getRelay
 * @returns {() => {
 *   rows: import('./community-channel-rows.js').ChannelRow[],
 *   information: any,
 *   authRequired: boolean,
 *   authRefused: string | null,
 *   loading: boolean
 * }}
 */
export function useHostChannels(getRelay) {
  const getMyGroups = useMyGroups();
  // The user's own list, narrowed to THIS host: it is one of the three
  // sources, and the only one that can name a channel the relay hides.
  const remembered = () =>
    getMyGroups()
      .filter((group) => group.relay === getRelay())
      .map((group) => group.id);

  const getDirectory = useRelayDirectory(getRelay, remembered);
  const getInformation = useRelayInformation(getRelay);

  return () => {
    const relay = getRelay();
    const directory = getDirectory();
    const information = getInformation();
    return {
      // Auth gating is read from BOTH mouths: the NIP-11 claim and the live
      // REQ that was actually closed auth-required. Either alone suffices —
      // a channel on such a host must not claim the globe.
      rows: relay
        ? rowsFrom(
            directory.metadata,
            relay,
            directory.authRequired || relayRequiresAuth(information)
          )
        : [],
      information,
      authRequired: directory.authRequired,
      authRefused: directory.authRefused,
      loading: directory.loading
    };
  };
}

/**
 * Metadata events -> the row shape both rails render, so the glyph, the access
 * wording and the "still loading" state are decided in exactly one place.
 * @param {any[]} metadata
 * @param {string} relay
 * @param {boolean} [hostRequiresAuth]
 */
function rowsFrom(metadata, relay, hostRequiresAuth = false) {
  // A flat host directory: every kind:39000 is a channel row (no parent/root
  // filtering, unlike a community subtree). Map each into the SubtreeChannel
  // shape buildChannelRows now consumes, with its level computed here.
  /** @type {Array<import('./subtree-channels.js').SubtreeChannel>} */
  const subtreeChannels = [];
  for (const event of metadata ?? []) {
    const id = dTagOf(event);
    if (!id) continue;
    subtreeChannels.push({
      id,
      relay,
      name: nameOf(event),
      level: channelAccessLevel(event, undefined, hostRequiresAuth),
      metadata: event
    });
  }
  return buildChannelRows({ subtreeChannels });
}
