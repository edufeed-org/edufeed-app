// Resolves the deployment's landing showcase lists (LANDING_SHOWCASE_LISTS,
// kind 30000 naddrs) into the pubkeys — accounts and communities — whose
// content may appear on the logged-out landing. Same fetch as the curated
// author sets, so a list is edited the same way (any NIP-51 list editor).
import { firstValueFrom } from 'rxjs';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import {
  decodeNaddrs,
  extractPubkeysFromFollowSets
} from '$lib/services/curated-authors-service.svelte.js';

/**
 * @param {string[]} naddrs
 * @returns {Promise<string[]>}
 */
export async function loadShowcaseSources(naddrs) {
  const pointers = decodeNaddrs(naddrs);
  const events = await Promise.all(
    pointers.map((pointer) =>
      // First answer wins: a hanging relay must not hold the landing for the
      // whole request timeout. Kind 30000 is replaceable; a stale copy is
      // replaced on the next visit's refresh.
      firstValueFrom(
        pool.request(
          pointer.relays.length > 0 ? pointer.relays : getAllLookupRelays(),
          { kinds: [30000], authors: [pointer.pubkey], '#d': [pointer.identifier] },
          /** @type {any} */ ({ timeout: 5000 })
        )
      )
        .then((event) => [event])
        .catch(() => [])
    )
  );
  return extractPubkeysFromFollowSets(events.flat());
}
