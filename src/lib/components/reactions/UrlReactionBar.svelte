<script>
  /**
   * UrlReactionBar - URL-rooted (NIP-25 kind 17 + NIP-73) reaction bar.
   * Mirror of ReactionBar but targets a URL instead of a Nostr event.
   *
   * @component
   */
  /* eslint-disable svelte/prefer-svelte-reactivity -- Map used intentionally to avoid infinite loops */
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { aggregateReactions, publishReactionForUrl } from '$lib/helpers/reactions.js';
  import { reactionsLoaderForUrl } from '$lib/loaders/reactions.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import ReactionButton from './ReactionButton.svelte';
  import AddReactionButton from './AddReactionButton.svelte';

  /** @type {{ url: string, lazy?: boolean, relays?: string[] }} */
  let { url, lazy = false, relays } = $props();

  /** @type {import('rxjs').Subscription | undefined} */
  let modelSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let removeSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSubscription;

  /** @type {any[]} */
  let reactions = $state([]);
  let loadedReactions = new Map();

  const getActiveUser = useActiveUser();

  let aggregated = $derived(aggregateReactions(reactions, getActiveUser()?.pubkey));

  // Subscribe to EventStore for cached + incoming kind 17 reactions targeting this URL
  $effect(() => {
    if (!url) return;

    loadedReactions.clear();

    modelSubscription = eventStore
      .timeline({ kinds: [17], '#i': [url] })
      .subscribe((/** @type {any[]} */ reactionEvents) => {
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

    removeSubscription = eventStore.remove$.subscribe((/** @type {any} */ removedEvent) => {
      if (removedEvent.kind === 17 && loadedReactions.has(removedEvent.id)) {
        loadedReactions.delete(removedEvent.id);
        reactions = Array.from(loadedReactions.values());
      }
    });

    return () => {
      modelSubscription?.unsubscribe();
      removeSubscription?.unsubscribe();
    };
  });

  /** @type {HTMLDivElement | undefined} */
  let containerEl = $state(undefined);

  // Network loader: lazy (intersection) or eager (200ms defer)
  $effect(() => {
    if (!url) return;

    if (lazy) {
      if (!containerEl) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            observer.disconnect();
            const loader = reactionsLoaderForUrl(url, relays);
            loaderSubscription = loader().subscribe({
              error: (/** @type {any} */ error) =>
                console.error('UrlReactionBar: Error loading reactions:', error)
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

    const timer = setTimeout(() => {
      const loader = reactionsLoaderForUrl(url, relays);
      loaderSubscription = loader().subscribe({
        error: (/** @type {any} */ error) =>
          console.error('UrlReactionBar: Error loading reactions:', error)
      });
    }, 200);

    return () => {
      clearTimeout(timer);
      loaderSubscription?.unsubscribe();
    };
  });

  /**
   * @param {string} emoji
   * @param {{ userReacted: boolean, userReactionEvent: any }} summary
   */
  function toggleReaction(emoji, summary) {
    const activeUser = getActiveUser();
    if (!activeUser) return;

    if (summary.userReacted && summary.userReactionEvent) {
      deleteEvent(summary.userReactionEvent, activeUser).catch((err) => {
        console.error('UrlReactionBar: Failed to delete reaction:', err);
      });
    } else {
      publishReactionForUrl(url, emoji).catch((err) => {
        console.error('UrlReactionBar: Failed to publish reaction:', err);
      });
    }
  }

  /**
   * @param {string | { shortcode: string, url: string }} emoji
   */
  function handlePick(emoji) {
    publishReactionForUrl(url, emoji).catch((err) => {
      console.error('UrlReactionBar: Failed to publish reaction:', err);
    });
  }
</script>

{#if url}
  <div
    bind:this={containerEl}
    class="flex min-h-[32px] flex-wrap items-center gap-2"
    data-testid="url-reaction-bar"
  >
    {#each Array.from(aggregated.entries()) as [emoji, summary] (emoji)}
      <ReactionButton
        {emoji}
        count={summary.count}
        userReacted={summary.userReacted}
        userReactionEvent={summary.userReactionEvent}
        emojiUrl={summary.emojiUrl}
        reactors={summary.reactors}
        onToggle={() => toggleReaction(emoji, summary)}
      />
    {/each}

    <AddReactionButton onPick={handlePick} />
  </div>
{/if}
