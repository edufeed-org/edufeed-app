<script>
  import GroupChat from '$lib/components/groups/GroupChat.svelte';
  import { parseGroupInput } from '$lib/groups/groups.js';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
  const pointer = $derived(parseGroupInput(data.rawPointer));
</script>

<svelte:head>
  <title>{pointer ? pointer.id : 'Groups'} — edufeed</title>
</svelte:head>

{#if pointer}
  <div class="h-[calc(100vh-4rem)]">
    <GroupChat {pointer} />
  </div>
{:else}
  <div class="p-8 text-center text-sm opacity-70">{m.groups_invalid_pointer()}</div>
{/if}
