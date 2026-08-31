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
  import { aggregateReactions, deleteReaction } from '$lib/helpers/reactions.js';
  import { reactionsStore } from '$lib/stores/reactions.svelte.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import ReactionChips from './ReactionChips.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ event: any, relays?: string[], lazy?: boolean, addButtonOnHover?: boolean }} */
  let { event, relays, lazy = false, addButtonOnHover = false } = $props();

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
  // Use regular Map (via aggregateReactions) — SvelteMap inside $derived can cause reactivity loops
  let aggregated = $derived(aggregateReactions(reactions, getActiveUser()?.pubkey));

  // Cache subscriptions: always start immediately to show cached reactions.
  $effect(() => {
    if (!event?.id) return;

    loadedReactions.clear();

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

    removeSubscription = eventStore.remove$.subscribe((removedEvent) => {
      if (removedEvent.kind === 7 && loadedReactions.has(removedEvent.id)) {
        loadedReactions.delete(removedEvent.id);
        reactions = Array.from(loadedReactions.values());
      }
    });

    return () => {
      modelSubscription?.unsubscribe();
      removeSubscription?.unsubscribe();
    };
  });

  // Relay loader: eager (200ms defer) or lazy (IntersectionObserver).
  // When lazy, only fetches when the component scrolls into view.
  /** @type {HTMLDivElement | undefined} */
  let containerEl = $state(undefined);

  $effect(() => {
    if (!event?.id) return;

    if (lazy) {
      if (!containerEl) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            observer.disconnect();
            loaderSubscription = reactionsLoader(event, relays).subscribe({
              error: (error) => console.error('ReactionBar: Error loading reactions:', error)
            });
          }
        },
        { rootMargin: '200px', threshold: 0.1 }
      );
      observer.observe(containerEl);
      return () => {
        observer.disconnect();
        loaderSubscription?.unsubscribe();
      };
    }

    // Eager: defer 200ms to avoid burst on feed load
    const loaderTimer = setTimeout(() => {
      loaderSubscription = reactionsLoader(event, relays).subscribe({
        error: (error) => console.error('ReactionBar: Error loading reactions:', error)
      });
    }, 200);

    return () => {
      clearTimeout(loaderTimer);
      loaderSubscription?.unsubscribe();
    };
  });

  /**
   * Toggle a reaction: delete the user's own reaction if they already reacted
   * with this emoji, otherwise publish it. Moved here (was ReactionButton's
   * internal default) so ReactionChips can stay a dumb presentational
   * component shared with UrlReactionBar + concord's ChannelChat.
   * @param {string} emoji
   * @param {import('$lib/helpers/reactions.js').ReactionSummary} summary
   */
  function toggleReaction(emoji, summary) {
    if (!getActiveUser()) return;

    if (summary.userReacted && summary.userReactionEvent) {
      deleteReaction(summary.userReactionEvent, { relays: runtimeConfig.fallbackRelays || [] })
        .then(() => showToast(m.reactions_remove_success(), 'success'))
        .catch((err) => {
          console.error('ReactionBar: Failed to remove reaction:', err);
          showToast(m.reactions_remove_error(), 'error');
        });
    } else {
      reactionsStore.react(event, emoji);
    }
  }

  /** @param {string | { shortcode: string, url: string }} emoji */
  function handlePick(emoji) {
    reactionsStore.react(event, emoji);
  }
</script>

{#if event?.id}
  <div
    bind:this={containerEl}
    class="flex flex-wrap items-center gap-2 {addButtonOnHover ? '' : 'min-h-[32px]'}"
    data-testid="reaction-bar"
  >
    <ReactionChips {aggregated} {addButtonOnHover} onToggle={toggleReaction} onPick={handlePick} />
  </div>
{/if}
