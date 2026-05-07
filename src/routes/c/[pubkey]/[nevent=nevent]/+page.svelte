<script>
  import { page } from '$app/stores';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import { npubToHex, fetchEventById } from '$lib/helpers/nostrUtils';
  import { resolveThreadContext } from '$lib/helpers/threadContext.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { decodeEventPointer } from 'applesauce-core/helpers';

  /** @type {{ data: any }} */
  let { data } = $props();

  // Convert community npub from URL to hex for #h tags on comments
  const communityPubkey = $derived(
    $page.params.pubkey ? (npubToHex($page.params.pubkey) ?? undefined) : undefined
  );

  let resolvedEvent = $state(/** @type {any} */ (null));
  let focusCommentId = $state(/** @type {string|null} */ (null));
  let parentPointer = $state(/** @type {string|null} */ (null));
  let scrollTo = $state(/** @type {string|null} */ (null));
  let isLoading = $state(true);

  $effect(() => {
    const nevent = data.nevent;
    if (!nevent) return;

    resolvedEvent = null;
    focusCommentId = null;
    parentPointer = null;
    scrollTo = null;
    isLoading = true;

    // Try EventStore synchronously first
    const pointer = decodeEventPointer(nevent);
    if (pointer) {
      const cached = eventStore.getEvent(pointer.id);
      if (cached) {
        showEvent(cached);
        return;
      }
    }

    // Fall back to network fetch
    fetchEventById(nevent).then((event) => {
      if (event) {
        showEvent(event);
      } else {
        isLoading = false;
      }
    });
  });

  /** @param {any} event */
  function showEvent(event) {
    resolvedEvent = event;
    isLoading = false;

    resolveThreadContext(event, fetchEventById).then((ctx) => {
      resolvedEvent = ctx.event;
      focusCommentId = ctx.focusCommentId ?? null;
      parentPointer = ctx.parentPointer ?? null;
      scrollTo = ctx.scrollTo ?? null;
    });
  }
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-6">
  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
    </div>
  {:else if resolvedEvent?.kind === 11 || resolvedEvent?.kind === 1 || resolvedEvent?.kind === 1111}
    <ThreadDetailView
      event={resolvedEvent}
      {parentPointer}
      initialFocusCommentId={focusCommentId}
      {scrollTo}
      {communityPubkey}
    />
  {:else if resolvedEvent?.kind === 1068}
    <PollCard event={resolvedEvent} truncate={false} />
  {:else if resolvedEvent}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-base-content/60">Unsupported content type (kind {resolvedEvent?.kind})</p>
    </div>
  {:else}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-base-content/60">Event not found</p>
    </div>
  {/if}
</div>
