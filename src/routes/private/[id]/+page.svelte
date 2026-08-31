<!--
  /private/[id] — standalone page for an UNLINKED Concord membership
  (Concord follow-up 1): a private area joined via another client (e.g.
  Armada) or a bare invite link, with no Communikey kind 10222 pointing at
  it on this deployment. Reuses PrivateChannelsView (same rail/chat/
  members/moderation/invite/dissolve UI a linked community's channels tab
  gets) with `communikeyEvent` omitted — see PrivateChannelsView's
  isCommunikeyOwner/isConcordOwner split for how it still resolves the real
  owner correctly (material.owner) without a 10222 to compare against.

  Imports concord submodules DIRECTLY, never the $lib/concord barrel — the
  convention every Concord call site follows (see CLAUDE.md's Concord
  section): the barrel deliberately never re-exports storage.js (a static
  applesauce-core-concord import) to stay SSR-clean. This route has
  ssr=false, but the import graph is still analyzed at build time, so the
  same submodule-import discipline applies regardless (see the @noble/hashes
  v2 SSR-chunk incident, commit a9af9c87).
-->
<script>
  import { getConcordState } from '$lib/concord/client.svelte.js';
  import { isConcordCommunityId, parseConcordPointer } from '$lib/concord/pointer.js';
  import { concordAreaDisplayName, privateAreaGate } from '$lib/concord/unlinked-areas.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getAllLookupRelays, getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import PrivateChannelsView from '$lib/components/community/channels/PrivateChannelsView.svelte';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();

  const getActiveUser = useActiveUser();
  const valid = $derived(isConcordCommunityId(data.communityId));

  // This page is for UNLINKED areas — but it used to claim "gehört zu keiner
  // Community" without ever checking (laoc, 2026-08-17: a member landed here
  // for an area that IS a community's Privater Bereich, minus the whole
  // community context). A tag like ["concord", id] is not relay-indexable, so
  // reverse lookup goes through the communities the USER follows: load their
  // 10222s (IDB-cached in practice) and match the pointer. On a hit, replace
  // this page with the community's Kanäle view, carrying ?channel= along.
  const getJoined = useJoinedCommunitiesList();
  let redirected = false;
  $effect(() => {
    const communityId = data.communityId;
    // Candidates: followed communities plus the area's own founder — a
    // wizard-founded area's owner IS the community keypair in the
    // current-keypair flow, so this finds the 10222 even for members who
    // never follow-set-joined the community.
    const owner = communityState?.material?.owner;
    const joined = [...new Set([...getJoined(), ...(owner ? [owner] : [])])];
    if (!valid || redirected || joined.length === 0) return;

    const channelParam = get(page)?.url?.searchParams.get('channel');
    const relays = [...new Set([...getAllLookupRelays(), ...getCommunikeyRelays()])];

    const modelSub = eventStore
      .timeline({ kinds: [10222], authors: joined })
      .subscribe((/** @type {any[]} */ events) => {
        if (redirected) return;
        for (const event of events ?? []) {
          if (parseConcordPointer(event)?.communityId !== communityId) continue;
          const npub = hexToNpub(event.pubkey);
          if (!npub) continue;
          redirected = true;
          const suffix = channelParam ? `&channel=${channelParam}` : '';
          goto(resolve(`/c/${npub}?view=channels${suffix}`), { replaceState: true });
          break;
        }
      });
    const loaderSubs = joined.map((pubkey) =>
      addressLoader({ kind: 10222, pubkey, relays }).subscribe()
    );

    return () => {
      modelSub.unsubscribe();
      loaderSubs.forEach((sub) => sub.unsubscribe());
    };
  });
  // Cascading gate (flag off > invalid id > logged out > render), pulled
  // into a pure/unit-tested function — see privateAreaGate's doc comment for
  // why the order matters.
  const gate = $derived(
    privateAreaGate({
      enabled: !!runtimeConfig.concord?.enabled,
      id: data.communityId,
      loggedIn: !!getActiveUser()
    })
  );

  const communityState = $derived(
    valid
      ? getConcordState().communities.find(
          (/** @type {any} */ c) => c.material?.community_id === data.communityId
        )
      : undefined
  );
  const areaName = $derived(
    communityState ? concordAreaDisplayName(communityState) : (data.communityId?.slice(0, 12) ?? '')
  );
</script>

<svelte:head>
  <title>{areaName} – {runtimeConfig.appName}</title>
</svelte:head>

<!-- Full-viewport shell (design prototype, approved 2026-07-23): `main`
  (src/routes/+layout.svelte) already sizes this route to the viewport minus
  the app topbar via its own flex-col/overflow-y-auto chain — h-full here
  resolves against that, same convention as the DM messages page
  (src/routes/c/(dashboard)/messages/+page.svelte). overflow-hidden keeps
  this route from ever needing ITS OWN scrollbar; only PrivateChannelsView's
  internal panes (rail list / chat messages) scroll. -->
<div class="flex h-full w-full flex-col overflow-hidden">
  {#if gate === 'disabled'}
    <div class="grid flex-1 place-items-center p-4">
      <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <h3 class="text-lg font-extrabold">{m.concord_join_disabled_title()}</h3>
        <p class="mt-2 text-sm text-base-content/60">{m.concord_join_disabled_body()}</p>
      </div>
    </div>
  {:else if gate === 'invalid'}
    <div class="grid flex-1 place-items-center p-4">
      <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <h3 class="text-lg font-extrabold">{m.concord_area_invalid_title()}</h3>
        <p class="mt-2 text-sm text-base-content/60">{m.concord_area_invalid_body()}</p>
      </div>
    </div>
  {:else if gate === 'login'}
    <div class="grid flex-1 place-items-center p-4">
      <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <h3 class="text-lg font-extrabold">{m.concord_join_login_title()}</h3>
        <p class="mt-2 text-sm text-base-content/60">{m.concord_area_login_body()}</p>
      </div>
    </div>
  {:else}
    <!-- Slim header bar (title/lock/Beta/unlinked note) — same header
      treatment as ChannelChat's own bar, so the standalone page reads as one
      continuous shell rather than a page wrapped around a boxed widget. -->
    <!-- Chrome surface (base-200): joins the sidebar + channel rail's beige
      nav zone; the chat pane below is the paper content surface. -->
    <header class="flex shrink-0 items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-3">
      <!-- ConcordAreaBadge shows the decrypted community icon when available
        (falling back to the abbreviation placeholder), with the lock glyph
        kept in its corner — replaces the bare 🔒 emoji that used to be the
        ONLY visual signal here, same rationale as the sidebar badges. -->
      <ConcordAreaBadge
        name={areaName}
        communityId={data.communityId}
        iconPointer={communityState?.metadata?.icon}
        class="h-8 w-8 shrink-0"
      />
      <div class="min-w-0 flex-1">
        <h1 class="flex items-center gap-2 truncate text-lg font-extrabold">
          {areaName}
          <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
        </h1>
        <p class="truncate text-xs text-base-content/50">{m.concord_unlinked_note()}</p>
      </div>
    </header>
    <div class="min-h-0 flex-1">
      <PrivateChannelsView communityId={data.communityId} />
    </div>
  {/if}
</div>
