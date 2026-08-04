<!--
  /groups — the user's NIP-29 relay groups (public entries of their kind-10009
  GROUPS list) plus a join-by-address form. Joining a NEW group navigates to
  its chat; the 10009 list update happens there via the Join flow (the group
  page is also where a bare visited-but-not-joined group lives).
-->
<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { storeEvents } from 'applesauce-relay/operators';
  import { TimelineModel } from 'applesauce-core/models';
  import { GROUPS_LIST_KIND, getPublicGroups } from 'applesauce-common/helpers/groups';
  import { parseGroupInput, groupHref } from '$lib/groups/groups.js';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();
  // $state.raw: the events are external store objects — deep-proxying them
  // makes applesauce's Symbol-cache writes (getPublicGroups) illegal inside
  // $derived (state_unsafe_mutation) and breaks event identity. TimelineModel
  // emits fresh arrays, so plain reassignment stays reactive.
  /** @type {any[]} */ let listEvents = $state.raw([]);

  $effect(() => {
    const me = getActiveUser()?.pubkey;
    if (!me) return;
    const filter = { kinds: [GROUPS_LIST_KIND], authors: [me] };
    /** @type {string[]} */
    const relays = runtimeConfig.fallbackRelays || [];
    const reqSub = pool
      .group(relays)
      .request(filter, { timeout: 8000 })
      .pipe(storeEvents(eventStore))
      .subscribe({ error: () => {} });
    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      listEvents = events;
    });
    return () => {
      reqSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  const groups = $derived.by(() => {
    const latest = listEvents[0];
    return latest ? (getPublicGroups(latest) ?? []) : [];
  });

  let input = $state('');

  function open() {
    const pointer = parseGroupInput(input);
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
        <li>
          <a
            href={resolve(/** @type {any} */ (groupHref(group)))}
            class="flex items-center gap-3 rounded border border-base-300 p-3 hover:bg-base-200"
          >
            <span class="font-mono text-sm">{group.id}</span>
            <span class="ml-auto text-xs opacity-60">{new URL(group.relay).hostname}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
