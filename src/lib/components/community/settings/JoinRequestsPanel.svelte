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
  import { parseGroupPointers } from '$lib/groups/community-pointer.js';
  import { putUserOn } from '$lib/groups/roster-fanout.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communikeyEvent: {pubkey?: string, tags?: string[][]} | null | undefined,
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
  let { communikeyEvent, communityId, roster, showEmpty = false } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  /** @type {any[]} */
  let joinRequestEvents = $state.raw([]);
  let dismissedIds = $state.raw(/** @type {Set<string>} */ (new Set()));
  let requestsSeq = $state(0);

  $effect(() => {
    dismissedIds = readDismissedJoinRequests(communityId);
  });

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
    for (const pointer of parseGroupPointers(communikeyEvent)) add(pointer);
    return byRelay;
  });

  $effect(() => {
    requestsSeq; // re-run after a successful NIP-42 authenticate
    const targets = groupTargets;
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
            if (!isAuthRequiredError(err) || !activeUser?.signer) return;
            authenticateOnce(pool.relay(relayUrl), activeUser.signer).then((response) => {
              if (response.ok) requestsSeq++;
            });
          }
        })
    );
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  const pendingRequests = $derived(
    pendingJoinRequests({
      events: joinRequestEvents,
      // Admins + the community's own seat count as "already in".
      members: new Set([
        ...roster.members,
        ...roster.admins.map((admin) => admin.pubkey),
        communityId
      ]),
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
      await putUserOn(roster.pointer, row.pubkey, [], /** @type {any} */ (user));
      roster.refresh();

      // The applicant knocked on a SPECIFIC channel (root queue also
      // collects channel-hosted 9021s, since a closed group only serves its
      // OWN requests) — honor that one ask, whatever tier it is. No sweep
      // beyond it: members-tier channels are self-joined via 9021 now (A4).
      const asked = parseGroupPointers(communikeyEvent).find(
        (pointer) => pointer.id === row.groupId
      );
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

{#if pendingRequests.length > 0 || showEmpty}
  <h3 class="text-sm font-bold">{m.community_join_requests_title()}</h3>
  <p class="text-sm text-base-content/70">{m.community_join_requests_lead()}</p>

  {#if pendingRequests.length === 0}
    <p class="mt-1 text-xs text-base-content/60" data-testid="join-requests-empty">
      {m.community_join_requests_empty()}
    </p>
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
