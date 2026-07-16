<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { PlusIcon, CloseIcon } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { createHub } from '$lib/stores/create-hub.svelte.js';
  import { npubToHex } from '$lib/helpers/nostrUtils.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { requireSigningOrToast } from '$lib/helpers/signing-guard.js';
  import * as m from '$lib/paraglide/messages';
  import {
    CREATE_ACTIONS,
    filterActionsForCommunity,
    suggestedActionIds
  } from '$lib/config/create-actions.js';
  import { startResourceCreation } from '$lib/helpers/contentCreation.js';

  let open = $state(false);
  /** @type {HTMLDivElement | undefined} */
  let fabRoot = $state(undefined);

  function close() {
    open = false;
  }

  // Open the sheet when another surface (e.g. Home quick action) requests it
  $effect(() => {
    if (createHub.requested) {
      open = true;
      createHub.requested = false;
    }
  });

  $effect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    /** @param {PointerEvent} e */
    const onPointer = (e) => {
      const target = /** @type {Node} */ (e.target);
      if (!fabRoot?.contains(target)) close();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  });

  // Detect community context from route (convert npub param to hex for consistent matching)
  let communityPubkey = $derived(
    $page.route.id?.startsWith('/c/')
      ? (npubToHex(/** @type {string} */ ($page.params.pubkey)) ?? '')
      : ''
  );

  let isDetailPage = $derived($page.route.id?.includes('[naddr=naddr]'));

  // Community definition (kind 10222) — filters the action list by allowed content kinds.
  /** @type {import('nostr-tools').Event | null} */
  let communityEvent = $state.raw(null);

  $effect(() => {
    if (!communityPubkey) {
      communityEvent = null;
      return;
    }

    const pointer = { kind: 10222, pubkey: communityPubkey };
    // Usually already in the EventStore via the community layout; the loader is a fallback.
    const loaderSub = addressLoader({ ...pointer, relays: getCommunikeyRelays() }).subscribe();
    const sub = eventStore.replaceable(pointer).subscribe((event) => {
      communityEvent = event || null;
    });

    return () => {
      loaderSub.unsubscribe();
      sub.unsubscribe();
    };
  });

  let visibleActions = $derived(filterActionsForCommunity(CREATE_ACTIONS, communityEvent));

  let suggestedActions = $derived.by(() => {
    const ids = suggestedActionIds(
      $page.route.id,
      $page.url?.searchParams?.get('view'),
      visibleActions
    );
    return ids.map((id) => visibleActions.find((a) => a.id === id)).filter((a) => a !== undefined);
  });

  let sections = $derived(
    [
      { key: 'suggested', title: m.fab_section_suggested(), actions: suggestedActions },
      {
        key: 'create',
        title: m.fab_section_create(),
        actions: visibleActions.filter((a) => a.section === 'create')
      },
      {
        key: 'add',
        title: m.fab_section_add(),
        actions: visibleActions.filter((a) => a.section === 'add')
      },
      {
        key: 'share',
        title: m.fab_section_share(),
        actions: visibleActions.filter((a) => a.section === 'share')
      }
    ].filter((s) => s.actions.length > 0)
  );

  /** @param {import('$lib/config/create-actions.js').CreateAction} action */
  function runAction(action) {
    // Readonly accounts get the upgrade prompt; anonymous users keep the
    // existing per-action behavior (login prompts inside the flows).
    if (manager.active && !requireSigningOrToast(manager.active)) {
      close();
      return;
    }
    action.run({
      communityPubkey,
      openModal: (name, props) =>
        modalStore.openModal(
          /** @type {import('$lib/stores/modal.svelte.js').ModalType} */ (name),
          props
        ),
      goto,
      resolve: (path) => resolve(/** @type {any} */ (path)),
      startResourceCreation: () => startResourceCreation({ communityPubkey })
    });
    close();
  }
</script>

{#if !isDetailPage}
  <!-- fabRoot wraps button + sheet so the click-outside listener doesn't dismiss
       when clicking inside the sheet (which sits outside the button's stack). -->
  <div bind:this={fabRoot}>
    {#if open}
      <!-- Backdrop scrim — tap to dismiss -->
      <button
        type="button"
        class="fixed inset-0 z-[55] cursor-default bg-(--c-scrim)"
        aria-label={m.aria_close_modal()}
        onclick={close}
      ></button>
    {/if}

    <div
      class="fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-[60] lg:right-6 lg:bottom-6"
    >
      <!-- Main FAB Button -->
      <button
        type="button"
        class="btn btn-circle shadow-lg btn-lg btn-accent hover:shadow-xl"
        aria-label={m.fab_open_menu()}
        aria-expanded={open}
        aria-haspopup="menu"
        onclick={() => (open = !open)}
      >
        {#if open}
          <CloseIcon class_="h-6 w-6" />
        {:else}
          <PlusIcon class_="h-6 w-6" />
        {/if}
      </button>
    </div>

    <!-- Create hub sheet: bottom sheet (< lg), anchored panel above the FAB (>= lg) -->
    {#if open}
      <div
        class="pb-safe fixed inset-x-0 bottom-0 z-[60] max-h-[80vh] overflow-y-auto rounded-t-2xl bg-base-100 shadow-2xl lg:inset-x-auto lg:right-6 lg:bottom-24 lg:w-96 lg:rounded-2xl"
        role="menu"
        aria-label={m.fab_open_menu()}
      >
        <!-- Grab handle (mobile) + close button row -->
        <div class="relative flex items-center justify-center pt-2 pb-1">
          <div class="h-1 w-12 rounded-full bg-base-content/20 lg:hidden"></div>
          <button
            type="button"
            class="btn absolute top-1 right-2 btn-circle btn-ghost btn-sm"
            aria-label={m.aria_close_modal()}
            onclick={close}
          >
            <CloseIcon class_="h-5 w-5" />
          </button>
        </div>

        <div class="space-y-5 px-4 pt-2 pb-6">
          {#each sections as section (section.key)}
            <section>
              <h3 class="mb-2 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
                {section.title}
              </h3>
              <div class="fab-grid grid grid-cols-3 gap-2">
                {#each section.actions as action (action.id)}
                  <button
                    type="button"
                    onclick={() => runAction(action)}
                    aria-label={action.ariaLabel()}
                    data-tip={action.description?.()}
                    class="flex flex-col items-center gap-1.5 rounded-xl bg-base-200 p-3 text-center transition-colors hover:bg-base-300 {action.description
                      ? 'tooltip'
                      : ''}"
                  >
                    <span class="text-primary"><action.icon class_="h-5 w-5" /></span>
                    <span class="text-xs leading-tight">{action.label()}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* DaisyUI centers tooltips on the tile (inset ... 50% + translateX(-50%)), which
     clips them at the sheet edge for tiles in the outer grid columns. Pin the
     tooltip to the tile's inner edge instead; the middle column keeps the default. */
  .fab-grid > :global(button:nth-child(3n + 1).tooltip[data-tip])::before {
    inset: auto auto var(--tt-off) 0;
    transform: translateY(var(--tt-pos, 0.25rem));
  }
  .fab-grid > :global(button:nth-child(3n).tooltip[data-tip])::before {
    inset: auto 0 var(--tt-off) auto;
    transform: translateY(var(--tt-pos, 0.25rem));
  }
</style>
