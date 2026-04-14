<script>
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getAddressPointerForEvent, encodePointer, getTagValue } from 'applesauce-core/helpers';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { resolveThreadContext } from '$lib/helpers/threadContext.js';
  import { fetchEventById, hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { decodeEventPointer } from 'applesauce-core/helpers';

  /** @type {{ data: any }} */
  let { data } = $props();

  let resolvedEvent = $state(/** @type {any} */ (null));
  let focusCommentId = $state(/** @type {string|null} */ (null));
  let parentPointer = $state(/** @type {string|null} */ (null));
  let scrollTo = $state(/** @type {string|null} */ (null));
  let isLoading = $state(true);
  let loadError = $state(/** @type {string|null} */ (null));

  $effect(() => {
    const nevent = data.nevent;
    if (!nevent) return;

    // Reset state
    resolvedEvent = null;
    focusCommentId = null;
    parentPointer = null;
    scrollTo = null;
    isLoading = true;
    loadError = null;

    // Step 1: Try EventStore synchronously (instant for feed-to-detail navigation)
    const pointer = decodeEventPointer(nevent);
    if (pointer) {
      const cached = eventStore.getEvent(pointer.id);
      if (cached) {
        handleEvent(cached, nevent);
        return;
      }
    }

    // Step 2: Fall back to network fetch (for direct URL access or cache miss)
    fetchEventById(nevent).then((event) => {
      if (event) {
        handleEvent(event, nevent);
      } else {
        isLoading = false;
        loadError = 'not_found';
      }
    });
  });

  /**
   * Process a fetched/cached event: handle redirects, then resolve thread context.
   * @param {any} event
   * @param {string} nevent
   */
  function handleEvent(event, nevent) {
    // If event has a community h-tag, redirect to community-scoped route
    const hTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'h');
    if (hTag?.[1]) {
      const npub = hexToNpub(hTag[1]);
      if (npub) {
        goto(resolve(`/c/${npub}/${nevent}`), { replaceState: true });
        return;
      }
    }

    // Check addressable event → redirect to naddr route
    const addrPointer = getAddressPointerForEvent(event);
    if (addrPointer) {
      const naddr = encodePointer(addrPointer);
      if (naddr) {
        goto(resolve(`/${naddr}`), { replaceState: true });
        return;
      }
    }

    // Show the event immediately
    resolvedEvent = event;
    isLoading = false;

    // Resolve thread context in background (may swap to root event for replies)
    resolveThreadContext(event, fetchEventById).then((ctx) => {
      resolvedEvent = ctx.event;
      focusCommentId = ctx.focusCommentId ?? null;
      parentPointer = ctx.parentPointer ?? null;
      scrollTo = ctx.scrollTo ?? null;
    });
  }

  const pageTitle = $derived.by(() => {
    if (!resolvedEvent) return `Event - ${runtimeConfig.appName}`;
    if (resolvedEvent.kind === 11) {
      const title = getTagValue(resolvedEvent, 'title') || getTagValue(resolvedEvent, 'subject');
      return `${title || 'Thread'} - ${runtimeConfig.appName}`;
    }
    return `Event - ${runtimeConfig.appName}`;
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="mx-auto w-full max-w-4xl px-4 py-6">
  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
    </div>
  {:else if loadError === 'not_found'}
    <div class="alert alert-error">
      <span>{m.route_failed_load_event()}</span>
    </div>
  {:else if resolvedEvent?.kind === 11 || resolvedEvent?.kind === 1 || resolvedEvent?.kind === 1111}
    <ThreadDetailView
      event={resolvedEvent}
      {parentPointer}
      initialFocusCommentId={focusCommentId}
      {scrollTo}
    />
  {:else if resolvedEvent}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <p class="text-base-content/60">
        {m.route_unsupported_event_kind({ kind: resolvedEvent.kind })}
      </p>
    </div>
  {/if}
</div>
