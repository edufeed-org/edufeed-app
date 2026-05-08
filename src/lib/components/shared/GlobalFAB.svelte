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
    ScrollTextIcon
  } from '$lib/components/icons';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { npubToHex } from '$lib/helpers/nostrUtils.js';
  import * as m from '$lib/paraglide/messages';
  import ResourceVariantPickerModal from '$lib/components/educational/ResourceVariantPickerModal.svelte';
  import { getEnabledVariants, getDefaultVariantId } from '$lib/config/resource-form-variants.js';

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
  }

  function handleCreateCalendar() {
    modalStore.openModal('createCalendar');
  }

  function handleCreateResource() {
    // Single-variant deployments skip the picker and navigate directly.
    // Multi-variant deployments open the step-0 picker modal.
    const variants = getEnabledVariants();
    if (variants.length <= 1) {
      goto(resourceUrlFor(getDefaultVariantId()));
      return;
    }
    variantPickerOpen = true;
  }

  function handleVariantSelect(/** @type {string} */ variantId) {
    variantPickerOpen = false;
    goto(resourceUrlFor(variantId));
  }

  function handleCreateArticle() {
    goto(resolve(`/create/article${communityPubkey ? `?community=${communityPubkey}` : ''}`));
  }

  function handleCreateWiki() {
    goto(resolve(`/create/wiki${communityPubkey ? `?community=${communityPubkey}` : ''}`));
  }

  function handleCreateForm() {
    goto(resolve('/forms/new'));
  }

  function handleAddBookmark() {
    modalStore.openModal('addBookmark', { communityPubkey });
  }

  function handleShareExisting() {
    modalStore.openModal('shareByNaddr', { communityPubkey });
  }
</script>

<ResourceVariantPickerModal
  open={variantPickerOpen}
  onSelect={handleVariantSelect}
  onClose={() => (variantPickerOpen = false)}
/>

{#if !isDetailPage}
  <div class="fab absolute right-6 bottom-20 z-[60] lg:bottom-6">
    <!-- Main FAB Button -->
    <div
      tabindex="0"
      role="button"
      class="btn btn-circle shadow-lg btn-lg btn-primary hover:shadow-xl"
      aria-label={m.fab_open_menu()}
    >
      <PlusIcon class_="h-6 w-6" />
    </div>

    <!-- Create Event -->
    <div class="fab-item">
      <span class="fab-label">{m.fab_create_event()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleCreateEvent}
        aria-label={m.fab_create_event_aria()}
      >
        <CalendarIcon class_="h-5 w-5" />
      </button>
    </div>

    <!-- Create Calendar -->
    <div class="fab-item">
      <span class="fab-label">{m.fab_create_calendar()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleCreateCalendar}
        aria-label={m.fab_create_calendar_aria()}
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
          />
        </svg>
      </button>
    </div>

    <!-- Create Learning Content -->
    <div class="fab-item">
      <span class="fab-label">{m.fab_create_resource()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleCreateResource}
        aria-label={m.fab_create_resource_aria()}
      >
        <GraduationCapIcon class_="h-5 w-5" />
      </button>
    </div>

    <!-- Write Article -->
    <div class="fab-item">
      <span class="fab-label">{m.article_fab_write()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleCreateArticle}
        aria-label={m.article_fab_write()}
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </button>
    </div>

    <!-- Write Wiki -->
    <div class="fab-item">
      <span class="fab-label">{m.wiki_fab_write()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleCreateWiki}
        aria-label={m.wiki_fab_write()}
      >
        <BookIcon class_="h-5 w-5" />
      </button>
    </div>

    <!-- Create Form -->
    <div class="fab-item">
      <span class="fab-label">{m.fab_create_form()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleCreateForm}
        aria-label={m.fab_create_form()}
      >
        <ScrollTextIcon class_="h-5 w-5" />
      </button>
    </div>

    <!-- Add Bookmark -->
    <div class="fab-item">
      <span class="fab-label">{m.fab_add_bookmark()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleAddBookmark}
        aria-label={m.fab_add_bookmark()}
      >
        <BookmarkIcon class_="h-5 w-5" />
      </button>
    </div>

    <!-- Share Existing Content -->
    <div class="fab-item">
      <span class="fab-label">{m.fab_share_existing()}</span>
      <button
        class="btn btn-circle btn-lg"
        onclick={handleShareExisting}
        aria-label={m.fab_share_existing_aria()}
      >
        <RepostIcon class_="h-5 w-5" />
      </button>
    </div>
  </div>
{/if}

<style>
  .fab {
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: 0.75rem;
  }

  .fab-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    opacity: 0;
    transform: scale(0.8) translateX(-10px);
    pointer-events: none;
    transition: all 0.2s ease;
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

  .fab:hover > .fab-item,
  .fab:focus-within > .fab-item {
    opacity: 1;
    transform: scale(1) translateX(0);
    pointer-events: auto;
  }

  .fab > .fab-item:nth-child(2) {
    transition-delay: 0.05s;
  }

  .fab > .fab-item:nth-child(3) {
    transition-delay: 0.1s;
  }

  .fab > .fab-item:nth-child(4) {
    transition-delay: 0.15s;
  }

  .fab > .fab-item:nth-child(5) {
    transition-delay: 0.2s;
  }

  .fab > .fab-item:nth-child(6) {
    transition-delay: 0.25s;
  }

  .fab > .fab-item:nth-child(7) {
    transition-delay: 0.3s;
  }

  .fab > .fab-item:nth-child(8) {
    transition-delay: 0.35s;
  }

  .fab > .fab-item:nth-child(9) {
    transition-delay: 0.4s;
  }
</style>
