<!--
  /groups — the user's NIP-29 relay groups (public entries of their kind-10009
  GROUPS list) plus a join-by-address form. Joining a NEW group navigates to
  its chat; the 10009 list update happens there via the Join flow (the group
  page is also where a bare visited-but-not-joined group lives).
-->
<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { groupHref, parseGroupAddress } from '$lib/groups/groups.js';
  import { useMyGroups } from '$lib/groups/unlinked-groups.svelte.js';
  import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
  import { metadataName } from '$lib/groups/unlinked-groups.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { updatePersonalGroupsList } from '$lib/groups/personal-groups-list.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { CloseIcon } from '$lib/components/icons';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  // The same hook the sidebar rail uses: it also asks the user's NIP-65
  // write relays — a kind-10009 is a USER-OWNED list, and fetching it from
  // the fallback relays alone made an unfound list look like an empty one.
  const getMyGroups = useMyGroups();
  const groups = $derived(getMyGroups());
  // Readable names live in each group's own kind:39000 — same map the rail
  // builds; the raw id is only the fallback while (or if) none arrives.
  const getChannelMeta = useChannelMetadata(() => groups);

  /** @param {{id: string, relay: string}} group */
  function displayName(group) {
    const key = channelKey(group);
    return (key && metadataName(getChannelMeta().byKey[key])) || group.id;
  }

  const getActiveUser = useActiveUser();

  /**
   * "Remove from my list" (issue 532c9210): drop the pointer from my own
   * kind-10009 — no roster change, nothing sent to the group relay. The row
   * disappears once the rewritten list lands in the store.
   * @param {{id: string, relay: string}} group
   */
  async function removeFromList(group) {
    try {
      await updatePersonalGroupsList(getActiveUser(), { remove: group });
      showToast(m.groups_list_removed(), 'success');
    } catch (err) {
      console.error('groups: 10009 update failed', err);
      showToast(m.groups_list_update_failed(), 'error');
    }
  }

  let input = $state('');

  function open() {
    // Forgiving about the scheme (handoff #7) — the attach modal already
    // accepted `https?://host'id`, unify the join field on the same parser.
    // parseGroupInput stays the strict form for internal/protocol callers.
    const pointer = parseGroupAddress(input);
    if (!pointer) {
      showToast(m.groups_invalid_pointer(), 'error');
      return;
    }
    goto(resolve(/** @type {any} */ (groupHref(pointer))));
  }
</script>

<svelte:head>
  <title>{m.groups_title()} — edufeed</title>
</svelte:head>

<div class="mx-auto max-w-2xl p-4">
  <h1 class="mb-4 text-lg font-bold">{m.groups_title()}</h1>

  <form
    class="mb-6 flex gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      open();
    }}
  >
    <input
      class="input-bordered input flex-1"
      data-testid="group-join-input"
      bind:value={input}
      placeholder={m.groups_join_placeholder()}
    />
    <button type="submit" class="btn btn-primary" disabled={!input.trim()}>
      {m.groups_add()}
    </button>
  </form>

  {#if groups.length === 0}
    <p class="text-sm opacity-60">{m.groups_empty()}</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each groups as group (group.relay + group.id)}
        <li class="flex items-center gap-1">
          <a
            href={resolve(/** @type {any} */ (groupHref(group)))}
            class="flex min-w-0 flex-1 items-center gap-3 rounded border border-base-300 p-3 hover:bg-base-200"
          >
            <span class="truncate text-sm">{displayName(group)}</span>
            <span class="ml-auto shrink-0 text-xs opacity-60">{new URL(group.relay).hostname}</span>
          </a>
          <!-- Beside the link, not inside it: an <a> may not nest a button. -->
          <button
            type="button"
            class="btn btn-circle shrink-0 btn-ghost btn-sm"
            data-testid="group-row-remove"
            aria-label={m.groups_list_remove()}
            title={m.groups_list_remove()}
            onclick={() => removeFromList(group)}
          >
            <CloseIcon class_="w-4 h-4" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
