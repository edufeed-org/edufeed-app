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
  import { isConcordCommunityId } from '$lib/concord/pointer.js';
  import { concordAreaDisplayName, privateAreaGate } from '$lib/concord/unlinked-areas.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import PrivateChannelsView from '$lib/components/community/channels/PrivateChannelsView.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();

  const getActiveUser = useActiveUser();
  const valid = $derived(isConcordCommunityId(data.communityId));
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

<div class="mx-auto flex h-[calc(100vh-4rem)] max-w-5xl flex-col p-4">
  {#if gate === 'disabled'}
    <div class="grid flex-1 place-items-center">
      <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <h3 class="text-lg font-extrabold">{m.concord_join_disabled_title()}</h3>
        <p class="mt-2 text-sm text-base-content/60">{m.concord_join_disabled_body()}</p>
      </div>
    </div>
  {:else if gate === 'invalid'}
    <div class="grid flex-1 place-items-center">
      <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <h3 class="text-lg font-extrabold">{m.concord_area_invalid_title()}</h3>
        <p class="mt-2 text-sm text-base-content/60">{m.concord_area_invalid_body()}</p>
      </div>
    </div>
  {:else if gate === 'login'}
    <div class="grid flex-1 place-items-center">
      <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
        <h3 class="text-lg font-extrabold">{m.concord_join_login_title()}</h3>
        <p class="mt-2 text-sm text-base-content/60">{m.concord_area_login_body()}</p>
      </div>
    </div>
  {:else}
    <div class="mb-3 shrink-0">
      <div class="flex items-center gap-2">
        <span class="text-lg">🔒</span>
        <h1 class="truncate text-lg font-extrabold">{areaName}</h1>
        <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
      </div>
      <p class="mt-1 text-xs text-base-content/50">{m.concord_unlinked_note()}</p>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden rounded-2xl border border-base-300 bg-base-100">
      <PrivateChannelsView communityId={data.communityId} />
    </div>
  {/if}
</div>
