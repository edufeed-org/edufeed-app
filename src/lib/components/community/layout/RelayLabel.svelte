<!--
  The relay's own name, falling back to its host.

  A component because the NIP-11 hook subscribes per instance and must only run
  where a relay is actually named — the same split as RailRelayIcon.
-->
<script>
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { relayDisplayName } from '$lib/groups/relay-directory.js';

  /** @type {{relay: string}} */
  let { relay } = $props();

  const getInformation = useRelayInformation(() => relay);
</script>

{relayDisplayName(getInformation(), relay)}
