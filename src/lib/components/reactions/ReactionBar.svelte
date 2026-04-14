<script>
  /**
   * ReactionBar - Container for all reactions on an event
   * Shows existing reactions and add button
   * Uses eventStore.reactions() + eventStore.remove$ for full reactivity
   * @component
   */
  /* eslint-disable svelte/prefer-svelte-reactivity -- Map used intentionally to avoid infinite loops */
  import { reactionsLoader } from '$lib/loaders/reactions.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { normalizeReactionContent, getCustomEmojiUrl } from '$lib/helpers/reactions.js';
  import ReactionButton from './ReactionButton.svelte';
  import AddReactionButton from './AddReactionButton.svelte';

  /** @type {any} */
  let { event, relays } = $props();

  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let removeSubscription;
  /** @type {any[]} */
  let reactions = $state([]);
  // Map to track loaded reactions and prevent duplicates
  // Use regular Map - SvelteMap in subscription callbacks can cause effect_update_depth_exceeded
  let loadedReactions = new Map();

  // Use reactive getter for active user to ensure proper reactivity on login/logout
  const getActiveUser = useActiveUser();

  // Derive aggregated reactions from reactions array
  // Use regular Map here - SvelteMap inside $derived can cause reactivity loops
  let aggregated = $derived.by(() => {
    const currentUser = getActiveUser();
    const agg = new Map();

    for (const reaction of reactions) {
      const emoji = normalizeReactionContent(reaction.content);
      const existing = agg.get(emoji) || {
        count: 0,
        userReacted: false,
        userReactionEvent: null,
        emojiUrl: null,
        reactors: []
      };

      const isUserReaction = currentUser && reaction.pubkey === currentUser.pubkey;

      existing.reactors.push(reaction.pubkey);
      agg.set(emoji, {
        count: existing.count + 1,
        userReacted: existing.userReacted || isUserReaction,
        userReactionEvent: isUserReaction ? reaction : existing.userReactionEvent,
        emojiUrl: existing.emojiUrl || getCustomEmojiUrl(reaction),
        reactors: existing.reactors
      });
    }

    return agg;
  });

  // Load reactions when component mounts or event changes.
  // Model + remove$ start immediately (show cached reactions).
  // Relay loader is deferred 200ms to avoid a burst of 19+ simultaneous relay queries on feed load.
  $effect(() => {
    if (!event?.id) {
      return;
    }

    // Reset the map when event changes
    loadedReactions.clear();

    // Subscribe to eventStore.reactions() for reactive updates (handles additions)
    modelSubscription = eventStore.reactions(event).subscribe((reactionEvents) => {
      let hasChanges = false;
      for (const reaction of reactionEvents || []) {
        if (!loadedReactions.has(reaction.id)) {
          loadedReactions.set(reaction.id, reaction);
          hasChanges = true;
        }
      }
      if (hasChanges) {
        reactions = Array.from(loadedReactions.values());
      }
    });

    // Subscribe to eventStore.remove$ to handle reaction deletions
    // Filter subscriptions don't re-emit on removals, so we need this
    removeSubscription = eventStore.remove$.subscribe((removedEvent) => {
      if (removedEvent.kind === 7 && loadedReactions.has(removedEvent.id)) {
        loadedReactions.delete(removedEvent.id);
        reactions = Array.from(loadedReactions.values());
      }
    });

    // Defer relay fetching to avoid burst of simultaneous connections on feed load
    const loaderTimer = setTimeout(() => {
      loaderSubscription = reactionsLoader(event, relays).subscribe({
        error: (error) => {
          console.error('ReactionBar: Error loading reactions:', error);
        }
      });
    }, 200);

    return () => {
      clearTimeout(loaderTimer);
      loaderSubscription?.unsubscribe();
      modelSubscription?.unsubscribe();
      removeSubscription?.unsubscribe();
    };
  });
</script>

{#if event?.id}
  <div class="flex min-h-[32px] flex-wrap items-center gap-2" data-testid="reaction-bar">
    <!-- Display reaction buttons -->
    {#each Array.from(aggregated.entries()) as [emoji, summary] (emoji)}
      <ReactionButton
        {event}
        {emoji}
        count={summary.count}
        userReacted={summary.userReacted}
        userReactionEvent={summary.userReactionEvent}
        emojiUrl={summary.emojiUrl}
        reactors={summary.reactors}
      />
    {/each}

    <!-- Add reaction button -->
    <AddReactionButton {event} />
  </div>
{/if}
