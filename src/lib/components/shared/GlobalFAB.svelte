<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import {
    PlusIcon,
    CalendarIcon,
    GraduationCapIcon,
    BookIcon,
    BookmarkIcon,
    RepostIcon,
    ScrollTextIcon,
    PollIcon,
    CloseIcon
  } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { npubToHex } from '$lib/helpers/nostrUtils.js';
  import * as m from '$lib/paraglide/messages';
  import ResourceVariantPickerModal from '$lib/components/educational/ResourceVariantPickerModal.svelte';
  import { getEnabledVariants, getDefaultVariantId } from '$lib/config/resource-form-variants.js';

  let open = $state(false);
  /** @type {HTMLDivElement | undefined} */
  let fabRoot = $state(undefined);

  function close() {
    open = false;
  }

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

  let variantPickerOpen = $state(false);

  /** Build the create URL for a given variant, preserving the community param. */
  function resourceUrlFor(/** @type {string} */ variantId) {
    const query = communityPubkey ? `?community=${communityPubkey}` : '';
    return resolve(`/create/resource/${variantId}${query}`);
  }

  // Detect community context from route (convert npub param to hex for consistent matching)
  let communityPubkey = $derived(
    $page.route.id?.startsWith('/c/')
      ? (npubToHex(/** @type {string} */ ($page.params.pubkey)) ?? '')
      : ''
  );

  let isDetailPage = $derived($page.route.id?.includes('[naddr=naddr]'));

  function handleCreateEvent() {
    modalStore.openModal('calendarEvent', {
      communityPubkey,
      selectedDate: new Date(),
      mode: 'create'
    });
    close();
  }

  function handleCreateCalendar() {
    modalStore.openModal('createCalendar');
    close();
  }

  function handleCreateResource() {
    // Single-variant deployments skip the picker and navigate directly.
    // Multi-variant deployments open the step-0 picker modal.
    const variants = getEnabledVariants();
    if (variants.length <= 1) {
      goto(resourceUrlFor(getDefaultVariantId()));
      close();
      return;
    }
    variantPickerOpen = true;
    close();
  }

  function handleVariantSelect(/** @type {string} */ variantId) {
    variantPickerOpen = false;
    goto(resourceUrlFor(variantId));
    close();
  }

  function handleCreateArticle() {
    goto(resolve(`/create/article${communityPubkey ? `?community=${communityPubkey}` : ''}`));
    close();
  }

  function handleCreateWiki() {
    goto(resolve(`/create/wiki${communityPubkey ? `?community=${communityPubkey}` : ''}`));
    close();
  }

  function handleCreateForm() {
    goto(resolve('/forms/new'));
    close();
  }

  function handleCreatePoll() {
    modalStore.openModal('createPoll', communityPubkey ? { communityPubkey } : {});
    close();
  }

  function handleAddBookmark() {
    modalStore.openModal('addBookmark', { communityPubkey });
    close();
  }

  function handleShareExisting() {
    modalStore.openModal('shareByNaddr', { communityPubkey });
    close();
  }

  // Single source of truth for the action list — feeds both desktop stack and mobile sheet.
  // Items render their icon via the {@render actionIcon(id)} snippet below.
  let actions = $derived([
    {
      id: 'event',
      section: 'create',
      label: m.fab_create_event(),
      ariaLabel: m.fab_create_event_aria(),
      onClick: handleCreateEvent
    },
    {
      id: 'calendar',
      section: 'create',
      label: m.fab_create_calendar(),
      ariaLabel: m.fab_create_calendar_aria(),
      onClick: handleCreateCalendar
    },
    {
      id: 'resource',
      section: 'create',
      label: m.fab_create_resource(),
      ariaLabel: m.fab_create_resource_aria(),
      onClick: handleCreateResource
    },
    {
      id: 'article',
      section: 'create',
      label: m.article_fab_write(),
      ariaLabel: m.article_fab_write(),
      onClick: handleCreateArticle
    },
    {
      id: 'wiki',
      section: 'create',
      label: m.wiki_fab_write(),
      ariaLabel: m.wiki_fab_write(),
      onClick: handleCreateWiki
    },
    {
      id: 'form',
      section: 'create',
      label: m.fab_create_form(),
      ariaLabel: m.fab_create_form(),
      onClick: handleCreateForm
    },
    {
      id: 'poll',
      section: 'create',
      label: m.fab_create_poll(),
      ariaLabel: m.fab_create_poll_aria(),
      onClick: handleCreatePoll
    },
    {
      id: 'bookmark',
      section: 'add',
      label: m.fab_add_bookmark(),
      ariaLabel: m.fab_add_bookmark(),
      onClick: handleAddBookmark
    },
    {
      id: 'share',
      section: 'share',
      label: m.fab_share_existing(),
      ariaLabel: m.fab_share_existing_aria(),
      onClick: handleShareExisting
    }
  ]);

  let createActions = $derived(actions.filter((a) => a.section === 'create'));
  let addActions = $derived(actions.filter((a) => a.section === 'add'));
  let shareActions = $derived(actions.filter((a) => a.section === 'share'));
</script>

{#snippet actionIcon(/** @type {string} */ id)}
  {#if id === 'event'}
    <CalendarIcon class_="h-5 w-5" />
  {:else if id === 'calendar'}
    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
      />
    </svg>
  {:else if id === 'resource'}
    <GraduationCapIcon class_="h-5 w-5" />
  {:else if id === 'article'}
    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  {:else if id === 'wiki'}
    <BookIcon class_="h-5 w-5" />
  {:else if id === 'form'}
    <ScrollTextIcon class_="h-5 w-5" />
  {:else if id === 'poll'}
    <PollIcon class_="h-5 w-5" />
  {:else if id === 'bookmark'}
    <BookmarkIcon class_="h-5 w-5" />
  {:else if id === 'share'}
    <RepostIcon class_="h-5 w-5" />
  {/if}
{/snippet}

<ResourceVariantPickerModal
  open={variantPickerOpen}
  onSelect={handleVariantSelect}
  onClose={() => (variantPickerOpen = false)}
/>

{#if !isDetailPage}
  <!-- fabRoot wraps button + both menus so the click-outside listener doesn't dismiss
       when clicking inside the mobile bottom sheet (which sits outside the button's stack). -->
  <div bind:this={fabRoot}>
    {#if open}
      <!-- Backdrop scrim — tap to dismiss -->
      <button
        type="button"
        class="fixed inset-0 z-[55] cursor-default bg-black/40"
        aria-label={m.aria_close_modal()}
        onclick={close}
      ></button>
    {/if}

    <div
      class="fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-[60] flex flex-col-reverse items-end gap-3 lg:right-6 lg:bottom-6"
    >
      <!-- Main FAB Button -->
      <button
        type="button"
        class="btn btn-circle shadow-lg btn-lg btn-primary hover:shadow-xl"
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

      {#if open}
        <!-- Desktop (lg:+) — vertical stack with circle buttons + floating labels -->
        <div
          class="fab-items hidden max-h-[70vh] flex-col-reverse items-end gap-3 overflow-y-auto pr-1 lg:flex"
          role="menu"
        >
          {#each actions as action (action.id)}
            <div class="fab-item">
              <span class="fab-label">{action.label}</span>
              <button
                class="btn btn-circle btn-lg"
                onclick={action.onClick}
                aria-label={action.ariaLabel}
              >
                {@render actionIcon(action.id)}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Mobile / tablet (< lg) — bottom sheet with grouped tiles -->
    {#if open}
      <div
        class="pb-safe fixed inset-x-0 bottom-0 z-[60] max-h-[80vh] overflow-y-auto rounded-t-2xl bg-base-100 shadow-2xl lg:hidden"
        role="menu"
        aria-label={m.fab_open_menu()}
      >
        <!-- Grab handle + close button row -->
        <div class="relative flex items-center justify-center pt-2 pb-1">
          <div class="h-1 w-12 rounded-full bg-base-content/20"></div>
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
          <section>
            <h3 class="mb-2 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
              {m.fab_section_create()}
            </h3>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {#each createActions as action (action.id)}
                <button
                  type="button"
                  onclick={action.onClick}
                  aria-label={action.ariaLabel}
                  class="flex flex-col items-center gap-1.5 rounded-xl bg-base-200 p-3 text-center transition-colors hover:bg-base-300"
                >
                  <span class="text-primary">{@render actionIcon(action.id)}</span>
                  <span class="text-xs leading-tight">{action.label}</span>
                </button>
              {/each}
            </div>
          </section>

          <section>
            <h3 class="mb-2 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
              {m.fab_section_add()}
            </h3>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {#each addActions as action (action.id)}
                <button
                  type="button"
                  onclick={action.onClick}
                  aria-label={action.ariaLabel}
                  class="flex flex-col items-center gap-1.5 rounded-xl bg-base-200 p-3 text-center transition-colors hover:bg-base-300"
                >
                  <span class="text-primary">{@render actionIcon(action.id)}</span>
                  <span class="text-xs leading-tight">{action.label}</span>
                </button>
              {/each}
            </div>
          </section>

          <section>
            <h3 class="mb-2 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
              {m.fab_section_share()}
            </h3>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {#each shareActions as action (action.id)}
                <button
                  type="button"
                  onclick={action.onClick}
                  aria-label={action.ariaLabel}
                  class="flex flex-col items-center gap-1.5 rounded-xl bg-base-200 p-3 text-center transition-colors hover:bg-base-300"
                >
                  <span class="text-primary">{@render actionIcon(action.id)}</span>
                  <span class="text-xs leading-tight">{action.label}</span>
                </button>
              {/each}
            </div>
          </section>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .fab-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  .fab-label {
    background-color: var(--color-base-100, hsl(var(--b1)));
    color: var(--color-base-content, hsl(var(--bc)));
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    line-height: 1.25rem;
    white-space: nowrap;
    box-shadow:
      0 1px 2px 0 rgb(0 0 0 / 0.05),
      0 1px 3px 0 rgb(0 0 0 / 0.1);
  }
</style>
