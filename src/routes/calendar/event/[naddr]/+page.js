import { nip19 } from 'nostr-tools';
import { fetchEventById } from '$lib/helpers/nostrUtils';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { initializeConfig } from '$lib/stores/config.svelte.js';

export const ssr = false;
export const prerender = false;

/**
 * The naddr as an address pointer for the page's live subscription
 * (useLatestReplaceableEvent): hint relays first, then the lookup relays —
 * hints may be dead, the same union fetchEventById asks.
 *
 * @param {string} naddr
 * @returns {{ kind: number, pubkey: string, identifier: string, relays: string[] } | null}
 */
function toPointer(naddr) {
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type !== 'naddr') return null;
    const { kind, pubkey, identifier, relays } = decoded.data;
    return {
      kind,
      pubkey,
      identifier,
      relays: [...new Set([...(relays ?? []), ...getAllLookupRelays()])]
    };
  } catch {
    return null;
  }
}

/** @type {import('./$types').PageLoad} */
export async function load({ params, parent }) {
  // Ensure runtime config is initialized before fetching.
  // Config is normally initialized in +layout.svelte (after all load functions),
  // but on a cold/direct load (shared link, address bar) we need it here for
  // relay resolution — otherwise hint-less naddrs can never resolve.
  const parentData = await parent();
  if (parentData.config) {
    initializeConfig(parentData.config);
  }

  // First paint only: the page follows newer revisions and deletions live.
  const rawEvent = await fetchEventById(params.naddr);
  const event = rawEvent ? getCalendarEventMetadata(rawEvent) : null;

  return {
    event,
    rawEvent, // Include raw event for AddToCalendarDropdown and editing
    naddr: params.naddr,
    pointer: toPointer(params.naddr)
  };
}
