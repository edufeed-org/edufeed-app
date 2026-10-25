<!--
  ProtectedBadge — a small lock on NIP-70 protected events (`["-"]` tag).
  Renders nothing for ordinary events.
-->
<script>
  import { isProtectedEvent } from 'applesauce-core/helpers/event';
  import { LockIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ event: { tags?: string[][] } | null | undefined, class?: string }} */
  let { event, class: className = '' } = $props();

  const isProtected = $derived(!!event?.tags && isProtectedEvent(/** @type {any} */ (event)));
</script>

{#if isProtected}
  <span
    class="tooltip inline-flex items-center align-middle text-base-content/60 {className}"
    data-tip={m.protected_badge_label()}
    data-testid="protected-badge"
  >
    <LockIcon class_="w-3.5 h-3.5" />
    <span class="sr-only">{m.protected_badge_label()}</span>
  </span>
{/if}
