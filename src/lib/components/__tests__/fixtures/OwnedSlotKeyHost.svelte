<!--
  Test host reproducing the root layout's shape: a chrome region that renders
  from a context-registered getter, and a {#key} block around the child that
  registers it. Bumping `epoch` remounts the child exactly like the
  account-switch remount in src/routes/+layout.svelte.
-->
<script>
  import { setContext } from 'svelte';
  import { createOwnedSlot } from '$lib/helpers/owned-slot.svelte.js';
  import OwnedSlotKeyChild from './OwnedSlotKeyChild.svelte';

  let { epoch = 0 } = $props();

  const slot = createOwnedSlot();
  setContext('claimSlot', slot.claim);
  let chrome = $derived(slot.value?.());
</script>

<div data-testid="chrome">{chrome ?? 'EMPTY'}</div>
{#key epoch}
  <OwnedSlotKeyChild label="child-{epoch}" />
{/key}
