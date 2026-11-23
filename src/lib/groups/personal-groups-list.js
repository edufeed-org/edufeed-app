// The user's kind-10009 GROUPS list, updated in place. Published to the
// user's OWN relays (outbox), never the group relay — the list is what makes
// joined and created groups roam across devices. Extracted from GroupChat so
// the relay page's create flow and the chat's join/leave speak through one
// door.
import { lastValueFrom, tap, timeout, toArray } from 'rxjs';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { unique } from '$lib/helpers/unique.js';
import { buildGroupsListTemplate } from './groups.js';

const CONFIRM_TIMEOUT_MS = 4000;

/**
 * The user's current kind 10009, asked from the relays before every edit.
 * The store alone is not enough: a list that has not arrived yet reads as "no
 * list", and an edit built on that replaced the whole list with one entry; a
 * copy another client changed since page load would lose those changes.
 *
 * Relay answers go into the store, which keeps the newest. With a copy in
 * hand the edit goes ahead even when no relay answered. Without one, "there
 * is no list" is believed only from one of the user's own write relays —
 * where the list is published — else this throws and nothing is written.
 * @param {string} pubkey
 */
async function confirmedGroupsList(pubkey) {
  const normal = (/** @type {string} */ url) => {
    try {
      return normalizeURL(url);
    } catch {
      return url;
    }
  };
  const own = ((await getWriteRelays(pubkey).catch(() => [])) ?? []).map(normal);
  const relays = unique([...own, ...getAllLookupRelays().map(normal)]);
  const answered = await Promise.all(
    relays.map((url) =>
      // pool.relay(url), never the pool-level request: a relay skipped as
      // parked would complete empty and read as "answered, no list".
      Promise.resolve()
        .then(() =>
          lastValueFrom(
            pool
              .relay(url)
              .request({ kinds: [10009], authors: [pubkey] })
              .pipe(
                timeout(CONFIRM_TIMEOUT_MS),
                tap((event) => eventStore.add(event)),
                toArray()
              )
          )
        )
        .then(
          () => true,
          () => false
        )
    )
  );
  const stored = eventStore.getReplaceable(10009, pubkey) ?? null;
  if (stored) return stored;
  if (!relays.some((url, i) => answered[i] && own.includes(url))) {
    throw new Error('groups list could not be confirmed: none of my relays answered');
  }
  return null;
}

/**
 * @param {{pubkey: string, signer: any} | null | undefined} user
 * @param {{add?: {id: string, relay: string}, remove?: {id: string, relay: string} | {id: string, relay: string}[]}} change
 */
export async function updatePersonalGroupsList(user, change) {
  if (!user?.signer) return;
  const existing = await confirmedGroupsList(user.pubkey);
  const template = buildGroupsListTemplate(existing, change);
  // No eventStore.add here: publishEventOptimistic captures the replaced
  // version BEFORE its own add (#64 rollback) — a pre-add would make that
  // capture see the replacement and roll a failed publish back to nothing.
  const signed = await user.signer.signEvent({ ...template, pubkey: user.pubkey });
  publishEventOptimistic(signed);
}
