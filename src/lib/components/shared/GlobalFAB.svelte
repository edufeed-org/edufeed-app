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

  // Detect community context from route (convert npub param to hex for consistent matching)
  let communityPubkey = $derived(
    $page.route.id?.startsWith('/c/') ? (npubToHex($page.params.pubkey) ?? '') : ''
  );

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
    goto(resolve(`/create/resource${communityPubkey ? `?community=${communityPubkey}` : ''}`));
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

<div class="fab fixed right-6 bottom-20 z-[60] lg:bottom-6">
  <!-- Main FAB Button -->
  <div
    tabindex="0"
    role="button"
    class="btn btn-circle shadow-lg btn-lg btn-primary hover:shadow-xl"
    aria-label="Open actions menu"
  >
    <PlusIcon class_="h-6 w-6" />
  </div>

  <!-- Create Event -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip="Create Event"
    onclick={handleCreateEvent}
    aria-label="Create new event"
  >
    <CalendarIcon class_="h-5 w-5" />
  </button>

  <!-- Create Calendar -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip="Create Calendar"
    onclick={handleCreateCalendar}
    aria-label="Create new calendar"
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

  <!-- Create Learning Content -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip="Create Learning Content"
    onclick={handleCreateResource}
    aria-label="Create new learning content"
  >
    <GraduationCapIcon class_="h-5 w-5" />
  </button>

  <!-- Write Article -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip={m.article_fab_write()}
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

  <!-- Write Wiki -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip={m.wiki_fab_write()}
    onclick={handleCreateWiki}
    aria-label={m.wiki_fab_write()}
  >
    <BookIcon class_="h-5 w-5" />
  </button>

  <!-- Create Form -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip={m.fab_create_form()}
    onclick={handleCreateForm}
    aria-label={m.fab_create_form()}
  >
    <ScrollTextIcon class_="h-5 w-5" />
  </button>

  <!-- Add Bookmark -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip="Add Bookmark"
    onclick={handleAddBookmark}
    aria-label="Add Bookmark"
  >
    <BookmarkIcon class_="h-5 w-5" />
  </button>

  <!-- Share Existing Content -->
  <button
    class="tooltip btn tooltip-left btn-circle btn-lg"
    data-tip="Share Existing Content"
    onclick={handleShareExisting}
    aria-label="Share existing content with community"
  >
    <RepostIcon class_="h-5 w-5" />
  </button>
</div>

<style>
  .fab {
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    gap: 0.75rem;
  }

  .fab > button {
    opacity: 0;
    transform: scale(0.8) translateY(10px);
    pointer-events: none;
    transition: all 0.2s ease;
  }

  .fab:hover > button,
  .fab:focus-within > button {
    opacity: 1;
    transform: scale(1) translateY(0);
    pointer-events: auto;
  }

  .fab > button:nth-child(2) {
    transition-delay: 0.05s;
  }

  .fab > button:nth-child(3) {
    transition-delay: 0.1s;
  }

  .fab > button:nth-child(4) {
    transition-delay: 0.15s;
  }

  .fab > button:nth-child(5) {
    transition-delay: 0.2s;
  }

  .fab > button:nth-child(6) {
    transition-delay: 0.25s;
  }

  .fab > button:nth-child(7) {
    transition-delay: 0.3s;
  }

  .fab > button:nth-child(8) {
    transition-delay: 0.35s;
  }

  .fab > button:nth-child(9) {
    transition-delay: 0.4s;
  }
</style>
