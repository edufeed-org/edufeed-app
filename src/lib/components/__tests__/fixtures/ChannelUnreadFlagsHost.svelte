<!--
  Test host proving the `{@const flags = channelUnreadState(...)}` +
  ConcordUnreadDot template pattern (used verbatim in PrivateChannelsView's
  channel-row {#each}, and in the Task 6 area/tab rollup sites) actually
  re-renders when the Concord notifications service's module $state changes.
  channelUnreadState() reads module-level $state.raw signals directly (no
  props/store plumbing), so this fixture exists purely to exercise that a
  real component mount tracks those reads through a rune block.
-->
<script>
  import { channelUnreadState } from '$lib/concord/notifications.svelte.js';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';

  let { communityId, channels = [] } = $props();
</script>

{#each channels as channel (channel.id)}
  {@const flags = channelUnreadState(communityId, channel.id)}
  <div data-testid="channel-row-{channel.id}">
    <ConcordUnreadDot unread={flags.unread} mentioned={flags.mentioned} />
  </div>
{/each}
