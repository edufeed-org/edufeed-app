<!--
  Child of OwnedSlotKeyHost: registers a getter in the host's slot on init and
  releases it on destroy — the same lifecycle c/[pubkey]/+layout.svelte and
  the messages/groups pages use against the root layout's context setters.
-->
<script>
  import { getContext } from 'svelte';

  let { label } = $props();

  /** @type {(getter: () => string) => () => void} */
  const claim = getContext('claimSlot');
  const release = claim(() => label);
  $effect(() => release);
</script>

<span data-testid="child">{label}</span>
