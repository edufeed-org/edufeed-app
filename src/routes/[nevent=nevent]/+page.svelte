<script>
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getTagValue } from 'applesauce-core/helpers';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { resolveThreadContext } from '$lib/helpers/threadContext.js';
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { getCanonicalEventRoute } from '$lib/helpers/eventRouteRedirect.js';
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
  // Kinds the inline ThreadDetailView can render — anything else needs to
  // redirect to a dedicated view (calendar event, article, etc.).
  const THREAD_VIEW_KINDS = new Set([1, 11, 1111]);

  /**
   * If the event has a dedicated route different from the current path,
   * redirect there and return true.
   * @param {any} event
   * @param {string} nevent
   */
  function maybeRedirectToCanonical(event, nevent) {
    const canonical = getCanonicalEventRoute(event);
    const currentPath = `/${nevent}`;
    if (canonical && canonical !== currentPath) {
      goto(resolve(/** @type {any} */ (canonical)), { replaceState: true });
      return true;
    }
    return false;
  }

  /**
   * Process a fetched/cached event: handle redirects, then resolve thread context.
   * @param {any} event
   * @param {string} nevent
   */
  function handleEvent(event, nevent) {
    // Addressables and h-tagged content redirect to dedicated views.
    if (maybeRedirectToCanonical(event, nevent)) return;

    // Show the event immediately
    resolvedEvent = event;
    isLoading = false;

    // Resolve thread context in background (may swap to root event for replies).
    // If the swap surfaces a non-thread root (e.g. a calendar event the
    // comment was attached to), redirect to that root's dedicated view.
    resolveThreadContext(event, fetchEventById).then((ctx) => {
      if (ctx.event !== event && !THREAD_VIEW_KINDS.has(ctx.event?.kind)) {
        if (maybeRedirectToCanonical(ctx.event, nevent)) return;
      }
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

<div class="container mx-auto px-4 py-8">
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
    <div class="alert alert-warning">
      <span>{m.route_unsupported_event_kind({ kind: resolvedEvent.kind })}</span>
    </div>
  {/if}
</div>
