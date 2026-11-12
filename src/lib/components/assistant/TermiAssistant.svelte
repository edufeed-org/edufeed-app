<script>
  // Termi — the edufeed assistant. Desktop: floating launcher stacked above
  // the create FAB. Phone: the launcher sits in the headers
  // (TermiLauncherButton) and opens the window through the termi-launcher
  // store; the bubble below is hidden there.
  import * as m from '$lib/paraglide/messages';
  import { useAssistantHints } from '$lib/stores/assistant-hints.svelte.js';
  import { page } from '$app/state';
  import { replaceState, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { TERMI_SKILLS, availableSkills } from '$lib/helpers/termi-skills.js';
  import { runCreateAction } from '$lib/helpers/run-create-action.js';
  import { skillsAsHostActions } from '$lib/termi/host.js';
  import { skillAction } from './termi-router.js';
  import { termiLauncher, closeTermi, openDraft } from '$lib/stores/termi-launcher.svelte.js';
  import TermiChatWindow from './TermiChatWindow.svelte';

  const { getHints, getOpenCount, runHint, customizeHint, dismissHint } = useAssistantHints();

  const getActiveUser = useActiveUser();

  /** @type {import('$lib/termi/host.js').TermiHost} */
  const host = {
    navigate: (href) => goto(/** @type {any} */ (href)),
    // shortcut: no consumer yet, becomes the WebMCP bridge / embedded-host seam when a second host exists
    actions: () => {
      const pubkey = getActiveUser()?.pubkey;
      const ctx = {
        npub: pubkey ? nip19.npubEncode(pubkey) : null,
        runCreate: (/** @type {any} */ action) =>
          runCreateAction(action, { goto, resolve: (path) => resolve(/** @type {any} */ (path)) }),
        runHelp: () => {} // required by skillAction's ctx type; help skills are never offered here
      };
      return skillsAsHostActions(availableSkills(TERMI_SKILLS, { loggedIn: !!pubkey }), {
        navigate: host.navigate,
        toAction: (skill) => skillAction(skill, ctx)
      });
    }
  };

  $effect(() => {
    termiLauncher.openCount = getOpenCount();
  });

  // ?termi=<id> opens that draft (dashboard links, shared across the user's devices)
  $effect(() => {
    const id = page.url.searchParams.get('termi');
    if (id) openDraft(id);
  });

  // the request stays in the URL while a draft is open: a reload would reopen it
  function clearDraftParam() {
    if (!page.url.searchParams.has('termi')) return;
    const url = new URL(page.url);
    url.searchParams.delete('termi');
    replaceState(url, page.state);
  }

  /** @param {boolean} open */
  function setWorkbench(open) {
    termiLauncher.workbench = open;
    if (!open) clearDraftParam();
  }

  function closeWindow() {
    closeTermi();
    clearDraftParam();
  }

  $effect(() => {
    termiLauncher.available = true;
    return () => {
      termiLauncher.available = false;
      closeTermi();
    };
  });
</script>

{#if !termiLauncher.open}
  <button
    type="button"
    data-testid="termi-launcher"
    aria-label={m.termi_launcher_aria()}
    class="termi-slot fixed right-[0.875rem] z-[60] hidden h-[52px] w-[52px] place-items-center rounded-full border border-base-300 bg-base-100 shadow-lg transition-transform hover:scale-105 lg:right-[1.375rem] lg:grid"
    onclick={() => (termiLauncher.open = true)}
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

{#if termiLauncher.open}
  {#if termiLauncher.expanded}
    <button
      type="button"
      class="fixed inset-0 z-[65] cursor-default bg-(--c-scrim)"
      aria-label={m.aria_close_modal()}
      onclick={closeWindow}
    ></button>
  {/if}
  <TermiChatWindow
    expanded={termiLauncher.expanded}
    workbench={termiLauncher.workbench}
    onWorkbench={setWorkbench}
    pendingId={termiLauncher.pendingId}
    onPendingHandled={() => (termiLauncher.pendingId = null)}
    onToggleExpand={() => (termiLauncher.expanded = !termiLauncher.expanded)}
    onClose={closeWindow}
    hints={getHints()}
    openCount={getOpenCount()}
    {runHint}
    {customizeHint}
    {dismissHint}
    {host}
  />
{/if}

<style>
  /* Keep in sync with .termi-slot in TermiChatWindow.svelte. */
  .termi-slot {
    bottom: calc(3.5rem + env(safe-area-inset-bottom) + 0.75rem);
  }
  @media (min-width: 1024px) {
    .termi-slot {
      bottom: 5.75rem;
    }
  }
</style>
