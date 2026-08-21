// Which communities in a share picker would swallow the user's share —
// reactive half of share-permission.js. The returned Set holds the
// communities where the share would publish fine and then never render.
//
// Two gate kinds, because two community types gate differently:
//   legacy/open  → a kind-30000 profile list, fetched and checked per section
//   moderated    → the NIP-29 root-group roster + the section's `access` tier
// Fails open everywhere data is missing or still loading (see
// share-permission.js) — greying out a legitimate publisher's row while the
// roster is in flight would be worse than briefly offering a row we later
// disable.
//
// Call during component init.
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getAllLookupRelays, getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import {
  sectionGateForKind,
  shareWouldBeVisible,
  rosterGateForKind
} from '$lib/helpers/share-permission.js';
import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
import { rosterView } from '$lib/groups/root-roster.js';
import { canPublishSection } from '$lib/groups/roster-access.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';

/** @param {string} address @returns {{kind: number, pubkey: string, identifier: string} | null} */
function parseAddress(address) {
  const [kindRaw, pubkey, ...rest] = String(address ?? '').split(':');
  const kind = Number(kindRaw);
  if (!Number.isInteger(kind) || !/^[0-9a-f]{64}$/.test(pubkey ?? '')) return null;
  return { kind, pubkey, identifier: rest.join(':') };
}

/**
 * @param {() => number | undefined} getKind kind of the event being shared
 * @param {() => string[]} getCommunityPubkeys candidate community pubkeys
 * @returns {() => Set<string>} community pubkeys whose share would be invisible
 */
export function useShareRestrictions(getKind, getCommunityPubkeys) {
  const getActiveUser = useActiveUser();

  // 10222s and gate lists live in the EventStore; a version counter bridges
  // their async arrival into the getter below. CRITICAL: the subscription
  // callbacks run SYNCHRONOUSLY (replaceable() replays cached events) inside
  // the $effect — `version++` would READ the $state and register it as a
  // dependency of the effect that writes it, a self-triggered infinite loop
  // (effect_update_depth_exceeded; same foot-gun documented in
  // joined-communikey-events.svelte.js). The plain `tick` counter keeps the
  // write write-ONLY.
  let version = $state(0);
  let tick = 0;
  /** @type {Set<string>} */
  const requested = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- session dedup, never rendered

  // Root-group pointers of the moderated candidates, batched through the ONE
  // roster loader (one REQ per relay covering all of them) rather than a
  // subscription per community. Declared after `version` so the getter can
  // depend on it — the 10222s it reads arrive asynchronously.
  const getRosters = useChannelRosters(() => {
    void version;
    const kind = getKind();
    /** @type {{id: string, relay: string}[]} */
    const pointers = [];
    for (const pubkey of getCommunityPubkeys()) {
      const gate = rosterGateForKind(eventStore.getReplaceable(10222, pubkey), kind);
      if (gate) pointers.push(gate.pointer);
    }
    return pointers;
  });

  $effect(() => {
    const kind = getKind();
    const pubkeys = getCommunityPubkeys();
    if (kind === undefined || pubkeys.length === 0) return;
    const relays = [...new Set([...getCommunikeyRelays(), ...getAllLookupRelays()])]; // eslint-disable-line svelte/prefer-svelte-reactivity -- dedup scratch

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    /** @type {Set<string>} */
    const listSubscribed = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- effect-local dedup
    for (const pubkey of pubkeys) {
      subs.push(
        eventStore.replaceable(10222, pubkey).subscribe((event) => {
          version = ++tick;
          const gate = sectionGateForKind(event, kind);
          const pointer = gate ? parseAddress(gate.address) : null;
          if (!pointer) return;
          const key = gate ? gate.address : '';
          if (!requested.has(key)) {
            requested.add(key);
            addressLoader({
              ...pointer,
              relays: gate?.relay ? [gate.relay, ...relays] : relays
            }).subscribe();
          }
          if (!listSubscribed.has(key)) {
            listSubscribed.add(key);
            subs.push(
              eventStore
                .replaceable(pointer.kind, pointer.pubkey, pointer.identifier)
                .subscribe(() => (version = ++tick))
            );
          }
        })
      );
    }
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  return () => {
    void version;
    const kind = getKind();
    const userPubkey = getActiveUser()?.pubkey;
    const rosters = getRosters();
    /** @type {Set<string>} */
    const restricted = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- returned snapshot, rebuilt per read
    for (const pubkey of getCommunityPubkeys()) {
      const event = eventStore.getReplaceable(10222, pubkey);

      // Moderated: the section's `access` tier against the root-group roster.
      const rosterGate = rosterGateForKind(event, kind);
      if (rosterGate) {
        const roster = rosterView(
          rosterGate.pointer,
          rosters.membersByKey,
          rosters.adminsByKey,
          rosters.fetchedKeys
        );
        // canPublishSection fails CLOSED while the roster loads, which is
        // right for hiding a composer but wrong here: a share picker must not
        // grey out a legitimate publisher's row on slow roster data.
        if (
          !roster.isLoading &&
          !canPublishSection(rosterGate.section, {
            pubkey: userPubkey,
            ownerPubkey: pubkey,
            roster
          })
        ) {
          restricted.add(pubkey);
        }
        continue;
      }

      // Legacy/open: the section's profile list.
      const gate = sectionGateForKind(event, kind);
      if (!gate) continue;
      const pointer = parseAddress(gate.address);
      if (!pointer) continue;
      const listEvent = eventStore.getReplaceable(pointer.kind, pointer.pubkey, pointer.identifier);
      if (!shareWouldBeVisible({ userPubkey, communityPubkey: pubkey, listEvent })) {
        restricted.add(pubkey);
      }
    }
    return restricted;
  };
}
