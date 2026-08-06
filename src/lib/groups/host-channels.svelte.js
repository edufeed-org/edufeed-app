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
import { channelKey } from './community-pointer.js';
import { useMyGroups } from './unlinked-groups.svelte.js';
import { useRelayDirectory } from './relay-directory.svelte.js';
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
    return {
      rows: relay ? rowsFrom(directory.metadata, relay) : [],
      information: getInformation(),
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
 */
function rowsFrom(metadata, relay) {
  /** @type {Record<string, any>} */
  const metadataByKey = {};
  /** @type {Array<{id: string, relay: string}>} */
  const pointers = [];
  for (const event of metadata ?? []) {
    const id = (event?.tags ?? []).find((/** @type {string[]} */ t) => t?.[0] === 'd')?.[1];
    if (!id) continue;
    const pointer = { id, relay };
    const key = channelKey(pointer);
    if (!key) continue;
    metadataByKey[key] = event;
    pointers.push(pointer);
  }
  return buildChannelRows({ groupPointers: pointers, metadataByKey });
}
