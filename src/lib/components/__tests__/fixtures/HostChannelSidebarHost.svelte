<!--
  A host for HostChannelSidebar that can change which channel is open WITHOUT
  remounting it.

  @testing-library/svelte's `rerender` remounts in Svelte 5 — measured: the
  sidebar opened a second relay subscription. A remount re-runs every effect,
  so it stamps the newly-opened channel read for the wrong reason and a test
  built on it passes however the dependency is wired. Switching a `$state`
  prop is the real thing: same component instance, same subscription.
-->
<script>
  import HostChannelSidebar from '$lib/components/groups/HostChannelSidebar.svelte';

  /** @type {{relay: string | null, initialActive?: string | null, next?: string | null}} */
  let { relay, initialActive = null, next = null } = $props();

  let active = $state(initialActive);
</script>

<button data-testid="switch-channel" type="button" onclick={() => (active = next)}>switch</button>
<HostChannelSidebar {relay} activeChannelId={active} />
