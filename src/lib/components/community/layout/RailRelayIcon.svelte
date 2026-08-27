<!--
  A relay's avatar in the rail — the same treatment a joined community gets.

  Split out for the same reason RailCommunityIcon is: the NIP-11 hook opens a
  subscription per instance, so it must only run for an entry that IS a relay.

  The picture and the name both come from the host's own NIP-11 document, which
  is what Armada's rail shows too (ServerRail.tsx: `info?.icon`, falling back
  to a letter). A relay that publishes neither keeps the initial it had before.
-->
<script>
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { relayIconUrl, relayDisplayName, relayLabel } from '$lib/groups/relay-directory.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';

  /**
   * @type {{
   *   relay: string,
   *   size?: string,
   *   rounded?: string
   * }}
   */
  let { relay, size = 'h-12 w-12', rounded = 'rounded-full' } = $props();

  const getInformation = useRelayInformation(() => relay);
  const information = $derived(getInformation());
  const icon = $derived(relayIconUrl(information));
  const name = $derived(relayDisplayName(information, relay));
</script>

{#if icon}
  <div class="avatar" data-testid="rail-relay-avatar">
    <div class="{size} {rounded}">
      <ImageWithFallback
        src={icon}
        alt={name}
        fallbackType="community"
        class="h-full w-full {rounded} object-cover"
      />
    </div>
  </div>
{:else}
  <span
    class="flex {size} items-center justify-center {rounded} bg-base-300 font-bold uppercase"
    data-testid="rail-relay-initial"
    aria-hidden="true">{relayLabel(relay).slice(0, 1)}</span
  >
{/if}
