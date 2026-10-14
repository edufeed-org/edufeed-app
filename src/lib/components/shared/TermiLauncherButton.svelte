<script>
  // Header-sized Termi launcher for phones. The floating bubble in
  // TermiAssistant is desktop-only; this button takes its place in the
  // mobile headers and opens the same chat window through the store.
  import * as m from '$lib/paraglide/messages';
  import { termiLauncher, openTermi } from '$lib/stores/termi-launcher.svelte.js';

  /** @type {{ class_?: string }} */
  let { class_ = '' } = $props();
</script>

{#if termiLauncher.available}
  <button
    type="button"
    data-testid="termi-header-launcher"
    aria-label={m.termi_launcher_aria()}
    class="btn relative btn-circle btn-ghost {class_}"
    onclick={openTermi}
  >
    <img src="/termi.png" alt="" class="h-7 w-7 object-contain" />
    {#if termiLauncher.openCount > 0}
      <span
        data-testid="termi-header-badge"
        class="absolute -top-0.5 -right-0.5 badge h-4 min-w-4 badge-sm text-[10px] badge-secondary"
      >
        {termiLauncher.openCount}
      </span>
    {/if}
  </button>
{/if}
