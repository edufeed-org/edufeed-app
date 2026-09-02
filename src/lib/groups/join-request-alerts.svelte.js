// Reactive half of the admin join-request alert (issue 68669ba4): app-wide
// count of pending NIP-29 Beitrittsanfragen for the groups the active user
// ADMINS, so Termi can nudge the admin instead of hoping they visit the
// members page. Composes the existing machinery end to end:
//
//   useMyGroupPointers  — every group I am on the roster of (#p REQ)
//   useChannelRosters   — full 39001/39002 rosters for those groups (#d REQ)
//   adminGroupPointers  — narrow to the groups whose 39001 lists me
//   own 9021 REQ        — stored join requests for those groups (admin-only
//                         read: proactive NIP-42 auth + auth-retry, exactly
//                         JoinRequestsPanel's dance)
//   pendingJoinRequests — same queue rules as the panel (newest per
//                         applicant+group, minus members, minus dismissed)
//   useJoinedCommunikeyEvents + groupToCommunityMap — which community a
//                         pending group belongs to, for the hint's target.
//
// MUST be called during component init (wraps $effect-based hooks).
import { untrack } from 'svelte';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { useMyGroupPointers } from './my-groups.svelte.js';
import { useChannelRosters } from './channel-rosters.svelte.js';
import { authenticateOnce, isAuthRequiredError } from './relay-auth.js';
import {
  pendingJoinRequests,
  readAllDismissedJoinRequests,
  JOIN_REQUESTS_DISMISSED_EVENT
} from './join-requests.js';
import {
  adminGroupPointers,
  membersByGroupId,
  groupToCommunityMap,
  summarizeJoinRequestAlert
} from './join-request-alerts.js';
import { useJoinedCommunikeyEvents } from '$lib/helpers/joined-communikey-events.svelte.js';

/**
 * @returns {() => {count: number, communities: Array<{pubkey: string, count: number, newest: number}>}}
 */
export function useAdminJoinRequestAlert() {
  const getActiveUser = useActiveUser();
  const getMyGroupPointers = useMyGroupPointers();
  const getRosters = useChannelRosters(getMyGroupPointers);

  // No groupsEnabled gate on purpose: that flag governs CREATION of moderated
  // communities, while an admin seat on an existing group works regardless
  // (same reason useShareableCommunities is ungated). Without groups relays
  // useMyGroupPointers yields nothing and the whole hook stays inert.
  const adminPointers = $derived(
    adminGroupPointers({
      pointers: getMyGroupPointers(),
      adminsByKey: getRosters().adminsByKey,
      pubkey: getActiveUser()?.pubkey ?? ''
    })
  );

  // ── 9021 fetch, keyed on a value-stable string so roster churn (new object
  //    identities, same content) does not reopen the subscriptions — the same
  //    idsKey rule channel-rosters.svelte.js documents. ──
  /** @type {any[]} */
  let joinRequestEvents = $state.raw([]);
  let authSeq = $state(0);

  const targetsKey = $derived(
    [...adminPointers]
      .map((pointer) => `${pointer.id}@${normalizeURL(pointer.relay)}`)
      .sort()
      .join('\x1f')
  );

  /** @returns {Map<string, string[]>} relay → group ids */
  function targetsByRelay() {
    /** @type {Map<string, string[]>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- effect-local accumulator, never rendered
    const byRelay = new Map();
    for (const pointer of adminPointers) {
      const relay = normalizeURL(pointer.relay);
      const ids = byRelay.get(relay) ?? [];
      if (!ids.includes(pointer.id)) ids.push(pointer.id);
      byRelay.set(relay, ids);
    }
    return byRelay;
  }

  // Proactive NIP-42 auth in its OWN effect, keyed on the target set and
  // deliberately NOT on authSeq: the 9021 read is admin-only and the relay
  // CLOSES an unauthenticated REQ `auth-required` (racing the REQ against
  // its own timeout showed admins an empty queue — JoinRequestsPanel, laoc
  // 2026-08-20). Folding this into the fetch effect below loops forever:
  // authenticateOnce resolves ok:true instantly on an already-authenticated
  // relay, the bump re-runs the effect, which authenticates again … (
  // measured: a pegged main thread). Same split the panel uses.
  $effect(() => {
    const key = targetsKey;
    const signer = getActiveUser()?.signer;
    if (key === '' || !signer) return;
    const targets = untrack(() => targetsByRelay());
    let cancelled = false;
    for (const relayUrl of targets.keys()) {
      authenticateOnce(pool.relay(relayUrl), signer).then((response) => {
        if (!cancelled && response.ok) authSeq++;
      });
    }
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    void authSeq; // re-run after a successful NIP-42 authenticate
    const key = targetsKey;
    const signer = getActiveUser()?.signer;
    joinRequestEvents = [];
    if (key === '') return;

    const targets = untrack(() => targetsByRelay());
    /** @type {any[]} */
    const collected = [];
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    let cancelled = false;

    for (const [relayUrl, ids] of targets) {
      subs.push(
        pool
          .relay(relayUrl)
          .request({ kinds: [9021], '#h': ids, limit: 100 }, { timeout: 8000 })
          .subscribe({
            next: (/** @type {any} */ event) => {
              if (cancelled) return;
              collected.push(event);
              joinRequestEvents = [...collected];
            },
            // An unreachable or refusing relay contributes nothing — the
            // alert is a nudge, not an authority; the panel stays the
            // surface that reports read errors.
            error: (/** @type {unknown} */ err) => {
              if (isAuthRequiredError(err) && signer) {
                authenticateOnce(pool.relay(relayUrl), signer).then((response) => {
                  if (!cancelled && response.ok) authSeq++;
                });
              }
            }
          })
      );
    }

    return () => {
      cancelled = true;
      subs.forEach((sub) => sub.unsubscribe());
    };
  });

  // ── Dismissals: re-read on the panel's same-tab signal AND on cross-tab
  //    storage events, so an "Ignorieren" clears the alert without a reload. ──
  let dismissed = $state.raw(readAllDismissedJoinRequests());
  $effect(() => {
    const refresh = () => {
      dismissed = readAllDismissedJoinRequests();
    };
    refresh();
    window.addEventListener(JOIN_REQUESTS_DISMISSED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(JOIN_REQUESTS_DISMISSED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  });

  const pending = $derived(
    pendingJoinRequests({
      events: joinRequestEvents,
      membersByGroup: membersByGroupId({
        pointers: adminPointers,
        membersByKey: getRosters().membersByKey,
        adminsByKey: getRosters().adminsByKey
      }),
      // Every event came from an `#h` REQ, so the no-h-tag root fallback
      // never applies.
      rootId: '',
      dismissed
    })
  );

  // The 10222s that map group ids to communities — only fetched once the
  // user actually admins something. The 39001 admins of those groups are the
  // candidate set beyond the follow-set join list: provisionRootGroup seats
  // the community pubkey itself as an admin, so the community is among them
  // even when the admin never follow-set-joined it (same trick as
  // useShareableCommunities).
  const getCommunikeyEvents = useJoinedCommunikeyEvents(
    () => adminPointers.length > 0,
    () => {
      const { adminsByKey } = getRosters();
      /** @type {string[]} */
      const candidates = [];
      for (const admins of Object.values(adminsByKey)) {
        for (const admin of admins ?? []) {
          if (!candidates.includes(admin.pubkey)) candidates.push(admin.pubkey);
        }
      }
      return candidates;
    }
  );

  return () =>
    summarizeJoinRequestAlert({
      pending,
      groupToCommunity: groupToCommunityMap(getCommunikeyEvents())
    });
}
