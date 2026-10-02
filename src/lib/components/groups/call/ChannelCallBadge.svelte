<!--
  ChannelCallBadge — a compact "● N in the call" for an AV channel's card,
  where the full ChannelCallRoster (avatars + its own Join button) cannot
  go: the card is itself a button. Same relay-signed kind 39004 source as
  the roster; renders nothing while the call is empty.

  Mount it only for AV channels (`row.av`): every instance holds a standing
  presence subscription.
-->
<script>
  import { useCallPresence } from '$lib/groups/call-presence.svelte.js';
  import CallCountPill from './CallCountPill.svelte';

  /** @type {{ pointer: {id: string, relay: string} }} */
  let { pointer } = $props();

  const getPresence = useCallPresence(() => pointer);
  const count = $derived(getPresence().participants.length);
</script>

{#if count > 0}
  <CallCountPill {count} testid="channel-card-call" />
{/if}
