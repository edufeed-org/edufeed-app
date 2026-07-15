<!--
  RenderErrorCard — fallback UI for the route-level <svelte:boundary> in
  +layout.svelte. Shown when a page throws during render (e.g. a malformed
  Nostr event tripping each_key_duplicate) so the app shell stays usable.

  Auto-resets on navigation: a failed boundary otherwise stays failed, which
  would leave every subsequent page stuck on this card.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { afterNavigate } from '$app/navigation';

  /** @type {{ error?: unknown, onretry?: () => void }} */
  let { error = undefined, onretry = undefined } = $props();

  const detail = $derived(error instanceof Error ? error.message : String(error ?? ''));

  afterNavigate(() => onretry?.());
</script>

<div class="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
  <div class="text-4xl" aria-hidden="true">⚠️</div>
  <h2 class="text-lg font-semibold">{m.render_error_title()}</h2>
  <p class="text-sm text-base-content/70">{m.render_error_description()}</p>
  {#if detail}
    <code class="max-w-full overflow-x-auto rounded bg-base-200 px-2 py-1 text-xs break-all">
      {detail}
    </code>
  {/if}
  <button type="button" class="btn btn-sm btn-primary" onclick={() => onretry?.()}>
    {m.render_error_retry()}
  </button>
</div>
