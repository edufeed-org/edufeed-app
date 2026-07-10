<script>
  // Termi — the edufeed assistant. Floating launcher stacked above the create
  // FAB; opens a popover chat (expandable to a side panel) that carries the
  // account-setup hints formerly shown as info banners, plus a canned Q&A.
  import * as m from '$lib/paraglide/messages';
  import { useAssistantHints } from '$lib/stores/assistant-hints.svelte.js';
  import TermiChatWindow from './TermiChatWindow.svelte';

  const { getHints, getOpenCount, runHint, customizeHint, dismissHint } = useAssistantHints();

  let open = $state(false);
  let expanded = $state(false);

  function close() {
    open = false;
    expanded = false;
  }
</script>

{#if !open}
  <button
    type="button"
    data-testid="termi-launcher"
    aria-label={m.termi_launcher_aria()}
    class="termi-slot fixed right-[0.875rem] z-[60] grid h-[52px] w-[52px] place-items-center rounded-full border border-base-300 bg-base-100 shadow-lg transition-transform hover:scale-105 lg:right-[1.375rem]"
    onclick={() => (open = true)}
  >
    <img src="/termi.png" alt="" class="h-9 w-9 object-contain" />
    {#if getOpenCount() > 0}
      <span
        data-testid="termi-badge"
        class="absolute -top-1 -right-1 box-content h-5 min-w-5 rounded-full border-2 border-base-100 bg-secondary px-1 text-center text-[11px] leading-5 font-bold text-secondary-content"
      >
        {getOpenCount()}
      </span>
    {/if}
  </button>
{/if}

{#if open}
  {#if expanded}
    <button
      type="button"
      class="fixed inset-0 z-[65] cursor-default bg-(--c-scrim)"
      aria-label={m.aria_close_modal()}
      onclick={close}
    ></button>
  {/if}
  <TermiChatWindow
    {expanded}
    onToggleExpand={() => (expanded = !expanded)}
    onClose={close}
    hints={getHints()}
    openCount={getOpenCount()}
    {runHint}
    {customizeHint}
    {dismissHint}
  />
{/if}

<style>
  /* Keep in sync with .termi-slot in TermiChatWindow.svelte. */
  .termi-slot {
    bottom: calc(4rem + env(safe-area-inset-bottom) + 0.75rem + 4.25rem);
  }
  @media (min-width: 1024px) {
    .termi-slot {
      bottom: 5.75rem;
    }
  }
</style>
