// Reactive wiring for the sidebar's "my groups" section.
//
// Three sources, all of them already built: the user's own kind-10009 list,
// the kind-10222s of every joined community (shared with the Concord side via
// helpers/joined-communikey-events.svelte.js), and the kind:39000 of each
// group (the same fetcher the community rail uses). The rule that combines
// them is pure and lives in unlinked-groups.js.
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { storeEvents } from 'applesauce-relay/operators';
import { TimelineModel } from 'applesauce-core/models';
import { GROUPS_LIST_KIND, getPublicGroups } from 'applesauce-common/helpers/groups';
import { useJoinedCommunikeyEvents } from '$lib/helpers/joined-communikey-events.svelte.js';
import { useChannelMetadata } from './channel-metadata.svelte.js';
import { linkedChannelKeys, unlinkedGroups } from './unlinked-groups.js';

/**
 * The public entries of the active user's kind-10009 groups list.
 *
 * `$state.raw` and a manual map rather than a `$derived` over the events:
 * applesauce's `getPublicGroups` memoises onto a Symbol on the event, and a
 * cache write from inside a `$derived` crashes the runtime (061c05c9).
 * @returns {() => Array<{id: string, relay: string}>}
 */
export function useMyGroups() {
  const getActiveUser = useActiveUser();
  /** @type {Array<{id: string, relay: string}>} */
  let groups = $state.raw([]);

  $effect(() => {
    const me = getActiveUser()?.pubkey;
    if (!me) {
      groups = [];
      return;
    }
    const filter = { kinds: [GROUPS_LIST_KIND], authors: [me] };
    /** @type {string[]} */
    const relays = runtimeConfig.fallbackRelays || [];
    const reqSub = pool
      .group(relays)
      .request(filter, { timeout: 8000 })
      .pipe(storeEvents(eventStore))
      .subscribe({ error: () => {} });
    // Accumulate nowhere and only WRITE the reactive state — the same rule
    // the channel-metadata hook follows, for the same reason.
    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      groups = getPublicGroups(/** @type {any} */ (events?.[0])) ?? [];
    });
    return () => {
      reqSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  return () => groups;
}

/**
 * The user's NIP-29 groups that no followed community shows as a channel —
 * the sidebar rows, mirroring what Concord already does for unlinked areas.
 *
 * NOT gated on the Concord flag: a NIP-29 group has nothing to do with
 * Concord, and inheriting that gate would leave every group looking unclaimed
 * (and therefore duplicated in the sidebar) wherever the flag is off.
 * @returns {() => import('./unlinked-groups.js').UnlinkedGroup[]}
 */
export function useUnlinkedGroups() {
  const getMyGroups = useMyGroups();
  const getCommunikeyEvents = useJoinedCommunikeyEvents();
  const getChannelMeta = useChannelMetadata(() => getMyGroups());

  return () =>
    unlinkedGroups({
      groups: getMyGroups(),
      linkedKeys: linkedChannelKeys(getCommunikeyEvents()),
      metadataByKey: getChannelMeta().byKey
    });
}
