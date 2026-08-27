<!--
  One NIP-29 channel, with its host's other channels beside it.

  This route used to be the chat and nothing else, so opening a channel from a
  relay's directory was a one-way trip: every other channel on that host was
  one back-navigation away (laoc, 2026-08-06). The sidebar is the way across,
  and it is the same list the directory renders.

  Switching between two channels of one host stays on THIS route, so the
  sidebar is not unmounted and the relay subscription behind it is not rebuilt
  — which is what makes the switch feel instant rather than merely work.
-->
<script>
  import GroupChat from '$lib/components/groups/GroupChat.svelte';
  import HostChannelSidebar from '$lib/components/groups/HostChannelSidebar.svelte';
  import { parseGroupInput } from '$lib/groups/groups.js';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();
  const pointer = $derived(parseGroupInput(data.rawPointer));
</script>

<svelte:head>
  <title>{pointer ? pointer.id : 'Groups'} — edufeed</title>
</svelte:head>

{#if pointer}
  <div class="flex h-[calc(100vh-4rem)] min-h-0 overflow-hidden">
    <HostChannelSidebar relay={pointer.relay} activeChannelId={pointer.id} />
    <div class="min-w-0 flex-1">
      <!-- Keyed on the channel: switching channels must remount the chat, or
           a draft typed in one would still be in the composer of the next. -->
      {#key `${pointer.relay}'${pointer.id}`}
        <GroupChat {pointer} />
      {/key}
    </div>
  </div>
{:else}
  <div class="p-8 text-center text-sm opacity-70">{m.groups_invalid_pointer()}</div>
{/if}
