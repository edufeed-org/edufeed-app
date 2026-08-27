<!--
  Beitrittsanfragen — the NIP-29-native application queue, extracted from
  MembershipPane so the Mitglieder view can carry it too (laoc, 2026-08-19:
  "I would expect it also for relevant actors somewhere in the community or
  under Mitglieder").

  Aggregates stored kind-9021 join requests across the ROOT group AND every
  channel group — an applicant who knocked on a channel's join bar sends the
  9021 h-tagged to THAT channel, and a root-only queue never saw it (the
  exact miss laoc hit). Relays serve 9021s only to members/admins
  (measured: CLOSED 'restricted: not a member' on groups.0xchat.com), so
  the REQs authenticate on demand.

  Aufnehmen = put-user on the root (community admission) + — when the
  applicant asked for a specific channel — a put-user on that channel too
  (A4, 2026-08-19: the members-tier blanket fan-out is retired; members join
  those channels themselves via their own 9021). Ignorieren = local
  dismissal by REQUEST id (a newer re-request resurfaces).

  Group-aware queue (final-review fix, 2026-08-19): membership is checked
  PER GROUP, not just against the root roster — an existing community member
  knocking on a closed CHANNEL is not yet a member of that channel, and a
  root-only check silently dropped their request before any admin saw it.
  `membersByGroup` unions the root roster with every channel roster this
  hook knows about (via useChannelRosters); a channel whose roster hasn't
  answered yet is treated as "requester not a member" (pendingJoinRequests'
  own safe-direction rule). approveRequest also tolerates the root put-user
  coming back "already a member" — a member re-knocking on a channel would
  otherwise abort before the channel grant ever went out.
-->
<script>
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { showToast } from '$lib/helpers/toast';
  import {
    pendingJoinRequests,
    readDismissedJoinRequests,
    writeDismissedJoinRequests
  } from '$lib/groups/join-requests.js';
  import { authenticateOnce, isAuthRequiredError } from '$lib/groups/relay-auth.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
  import { useCommunityChannels } from '$lib/groups/community-channels.svelte.js';
  import { putUserOn } from '$lib/groups/roster-fanout.js';
  import { isAlreadyMemberError } from '$lib/groups/groups.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communityId: string,
   *   roster: {
   *     pointer: {id: string, relay: string} | null,
   *     members: Set<string>,
   *     admins: Array<{pubkey: string, roles: string[]}>,
   *     refresh: () => void
   *   },
   *   showEmpty?: boolean
   * }}
   */
  let { communityId, roster, showEmpty = false } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  /** @type {any[]} */
  let joinRequestEvents = $state.raw([]);
  let dismissedIds = $state.raw(/** @type {Set<string>} */ (new Set()));
  let requestsSeq = $state(0);
  // A non-auth REQ rejection (e.g. "restricted: ...") must not read as "no
  // requests" — an empty queue and a broken queue look identical otherwise.
  let requestsError = $state('');

  $effect(() => {
    dismissedIds = readDismissedJoinRequests(communityId);
  });

  // The community's channels, DISCOVERED from the relay subtree (not from
  // kind-10222 `group` pointers). An applicant who knocked on a channel sent
  // their 9021 h-tagged to THAT channel's id, so the queue must know every
  // channel id to aggregate them.
  const getCommunityChannels = useCommunityChannels(() => roster.pointer);
  const channelPointers = $derived(
    getCommunityChannels().channels.map((c) => ({ id: c.id, relay: c.relay }))
  );
  // Per-channel rosters, so a group-aware membership check can tell "already
  // a member of THIS channel" from "already a member of the community" —
  // see the header comment.
  const getChannelRosters = useChannelRosters(() => channelPointers);

  // Requests are stored per GROUP — one REQ per relay covering the root and
  // every channel id it hosts.
  const groupTargets = $derived.by(() => {
    /** @type {Map<string, string[]>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt wholesale inside a $derived, never mutated after
    const byRelay = new Map();
    const add = (/** @type {{id: string, relay: string} | null} */ pointer) => {
      if (!pointer?.id || !pointer.relay) return;
      const ids = byRelay.get(pointer.relay) ?? [];
      if (!ids.includes(pointer.id)) ids.push(pointer.id);
      byRelay.set(pointer.relay, ids);
    };
    add(roster.pointer);
    for (const pointer of channelPointers) add(pointer);
    return byRelay;
  });

  $effect(() => {
    requestsSeq; // re-run after a successful NIP-42 authenticate
    const targets = groupTargets;
    requestsError = '';
    if (targets.size === 0) return;
    /** @type {any[]} */
    const collected = [];
    const subs = [...targets.entries()].map(([relayUrl, ids]) =>
      pool
        .relay(relayUrl)
        .request({ kinds: [9021], '#h': ids, limit: 100 }, { timeout: 8000 })
        .subscribe({
          next: (/** @type {any} */ event) => {
            collected.push(event);
            joinRequestEvents = [...collected];
          },
          error: (/** @type {any} */ err) => {
            if (isAuthRequiredError(err) && activeUser?.signer) {
              authenticateOnce(pool.relay(relayUrl), activeUser.signer).then((response) => {
                if (response.ok) requestsSeq++;
              });
              return;
            }
            // Not (successfully) recoverable via auth — surface it rather
            // than let this relay's requests silently vanish from the queue.
            requestsError = err instanceof Error ? err.message : String(err);
          }
        })
    );
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  // Proactive NIP-42 auth, not just reactive. The 9021 read is admin-only, so
  // the relay CLOSES the REQ `auth-required` — but that close can race the
  // request's own 8s timeout, and the admin then saw "Timeout has occurred"
  // instead of the queue (laoc, 2026-08-20). Authenticate each target relay up
  // front so the first read already runs authenticated; a success re-runs the
  // load (requestsSeq). authenticateOnce is idempotent (one AUTH per challenge)
  // and resolves ok:false harmlessly on a relay that never challenges. Mirrors
  // GroupChat's proactive auth for private channels.
  $effect(() => {
    const signer = activeUser?.signer;
    if (!signer) return;
    const targets = groupTargets;
    let cancelled = false;
    for (const relayUrl of targets.keys()) {
      authenticateOnce(pool.relay(relayUrl), signer).then((response) => {
        if (!cancelled && response.ok) requestsSeq++;
      });
    }
    return () => {
      cancelled = true;
    };
  });

  // Root roster + every known channel roster, keyed by bare group id (the
  // same id space a 9021's `h` tag and JoinRequestRow.groupId use — NOT the
  // relay-qualified channelKey). A channel absent from this map has an
  // UNKNOWN roster; pendingJoinRequests treats that as "not a member" on
  // purpose (overstating the queue beats silently dropping a real request).
  const membersByGroup = $derived.by(() => {
    /** @type {Map<string, Set<string>>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt wholesale inside a $derived, never mutated after
    const map = new Map();
    // Admins + the community's own seat count as "already in" for the ROOT
    // group only — a channel's own 39002 roster already reflects its
    // members (including pre-joined admins), so it needs no such union.
    if (roster.pointer?.id) {
      map.set(
        roster.pointer.id,
        new Set([...roster.members, ...roster.admins.map((admin) => admin.pubkey), communityId])
      );
    }
    const { membersByKey } = getChannelRosters();
    for (const pointer of channelPointers) {
      const key = channelKey(pointer);
      if (!key) continue;
      const known = membersByKey[key];
      if (known) map.set(pointer.id, known);
    }
    return map;
  });

  const pendingRequests = $derived(
    pendingJoinRequests({
      events: joinRequestEvents,
      membersByGroup,
      rootId: roster.pointer?.id ?? '',
      dismissed: dismissedIds
    })
  );
  const getRequestProfiles = useProfileMap(() => pendingRequests.map((row) => row.pubkey));

  let approving = $state('');

  /** @param {import('$lib/groups/join-requests.js').JoinRequestRow} row */
  async function approveRequest(row) {
    const user = activeUser;
    if (!user || !roster.pointer || approving) return;
    approving = row.id;
    try {
      try {
        await putUserOn(roster.pointer, row.pubkey, [], /** @type {any} */ (user));
      } catch (err) {
        // A member re-knocking on a channel already has a root seat — the
        // relay answers "already a member", not a failure. Continue to the
        // asked-channel grant below instead of aborting via the outer catch.
        if (!isAlreadyMemberError(err)) throw err;
      }
      roster.refresh();

      // The applicant knocked on a SPECIFIC channel (root queue also
      // collects channel-hosted 9021s, since a closed group only serves its
      // OWN requests) — honor that one ask, whatever tier it is. No sweep
      // beyond it: members-tier channels are self-joined via 9021 now (A4).
      const asked = channelPointers.find((pointer) => pointer.id === row.groupId);
      if (asked) {
        try {
          await putUserOn(asked, row.pubkey, [], /** @type {any} */ (user));
        } catch (err) {
          console.error('groups: channel put-user failed after approval', err);
          showToast(m.groups_members_action_failed(), 'warning');
        }
      }
      showToast(m.community_join_request_approved(), 'success');
    } catch (error) {
      console.error('join-request approval failed', error);
      showToast(
        m.community_join_request_approve_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      approving = '';
    }
  }

  /** @param {import('$lib/groups/join-requests.js').JoinRequestRow} row */
  function ignoreRequest(row) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw Set, replaced wholesale (CLAUDE.md pattern)
    const next = new Set(dismissedIds);
    next.add(row.id);
    dismissedIds = next;
    writeDismissedJoinRequests(communityId, next);
  }
</script>

{#if pendingRequests.length > 0 || showEmpty || requestsError}
  <h3 class="text-sm font-bold">{m.community_join_requests_title()}</h3>
  <p class="text-sm text-base-content/70">{m.community_join_requests_lead()}</p>

  {#if pendingRequests.length === 0}
    {#if requestsError}
      <p class="mt-1 text-xs text-error" data-testid="join-requests-error">
        {m.community_join_requests_error({ reason: requestsError })}
      </p>
    {:else}
      <p class="mt-1 text-xs text-base-content/60" data-testid="join-requests-empty">
        {m.community_join_requests_empty()}
      </p>
    {/if}
  {:else}
    <div class="mt-2 flex flex-col gap-2">
      {#each pendingRequests as row (row.id)}
        <div
          class="flex items-center gap-3 rounded-lg bg-base-200 px-3 py-2"
          data-testid="join-request-row"
          data-pubkey={row.pubkey}
        >
          <ProfileAvatar
            pubkey={row.pubkey}
            profile={getRequestProfiles().get(row.pubkey)}
            size="sm"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">
              {getUserDisplayName(row.pubkey, getRequestProfiles().get(row.pubkey))}
            </p>
            {#if row.reason}
              <p class="truncate text-xs text-base-content/60 italic">{row.reason}</p>
            {/if}
          </div>
          <button
            class="btn btn-ghost btn-sm"
            data-testid="join-request-ignore"
            onclick={() => ignoreRequest(row)}
          >
            {m.community_join_requests_ignore()}
          </button>
          <button
            class="btn btn-sm btn-primary"
            data-testid="join-request-approve"
            disabled={!!approving}
            onclick={() => approveRequest(row)}
          >
            {m.community_join_requests_approve()}
          </button>
        </div>
      {/each}
    </div>
  {/if}
{/if}
