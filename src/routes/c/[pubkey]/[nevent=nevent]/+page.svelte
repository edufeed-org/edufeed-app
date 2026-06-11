<script>
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import { npubToHex, fetchEventById } from '$lib/helpers/nostrUtils';
  import { resolveThreadContext } from '$lib/helpers/threadContext.js';
  import { getCanonicalEventRoute } from '$lib/helpers/eventRouteRedirect.js';
  import { getContentViewForKind } from '$lib/helpers/contentViewForKind.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
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
        showEvent(cached, nevent);
        return;
      }
    }

    // Fall back to network fetch
    fetchEventById(nevent).then((event) => {
      if (event) {
        showEvent(event, nevent);
      } else {
        isLoading = false;
      }
    });
  });

  // Keep the sidebar on the originating section (forum, polls, …) when
  // landing on a thread/poll detail URL without a `?view=` param. The
  // community layout reads `?view=` to pick the active tab, so once we
  // know the resolved event's kind we rewrite the URL in place. Only
  // fills in a missing view — never overrides an explicit one.
  //
  // We track the last id we patched so the effect remains idempotent
  // across re-runs (e.g. when resolveThreadContext reassigns
  // resolvedEvent to the same root). URL/state reads are untracked so
  // replaceState doesn't retrigger this effect.
  /** @type {string | null} */
  let patchedViewForId = null;
  $effect(() => {
    const event = resolvedEvent;
    if (!event) return;
    if (patchedViewForId === event.id) return;
    const view = getContentViewForKind(event.kind);
    if (!view) return;
    untrack(() => {
      patchedViewForId = event.id;
      if ($page.url.searchParams.has('view')) return;
      const next = new URL($page.url);
      next.searchParams.set('view', view);
      goto(next.pathname + next.search, {
        replaceState: true,
        noScroll: true,
        keepFocus: true
      });
    });
  });

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
    const currentPath = `/c/${$page.params.pubkey}/${nevent}`;
    if (canonical && canonical !== currentPath) {
      // Preserve the current URL's query string (e.g. ?view=forum) so the
      // community layout keeps the sidebar on the originating section.
      const target = canonical + $page.url.search;
      goto(resolve(/** @type {any} */ (target)), { replaceState: true });
      return true;
    }
    return false;
  }

  /**
   * @param {any} event
   * @param {string} nevent
   */
  function showEvent(event, nevent) {
    // Addressables and content for other communities redirect away.
    if (maybeRedirectToCanonical(event, nevent)) return;

    resolvedEvent = event;
    isLoading = false;

    // If thread context resolves to a non-thread root (e.g. a calendar event
    // this comment was attached to), redirect to that root's dedicated view.
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
    <div class="mt-6 border-y border-base-300 py-4">
      <ReactionBar event={resolvedEvent} />
    </div>
    <div class="mt-6">
      <CommentList rootEvent={resolvedEvent} activeUser={manager.active} {communityPubkey} />
    </div>
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
