<script>
  /**
   * ReactionButton - Individual pill-style reaction button
   * Shows emoji and count, highlights if user reacted
   * @component
   */
  import { reactionsStore } from '$lib/stores/reactions.svelte.js';
  import { TrashIcon } from '$lib/components/icons';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { deleteReaction } from '$lib/helpers/reactions.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {any} */
  let {
    event,
    emoji,
    count = 0,
    userReacted = false,
    userReactionEvent = null,
    emojiUrl = null
  } = $props();

  let isHovering = $state(false);

  // Track active user with direct subscription for proper reactivity
  let activeUser = $state(manager.active);

  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // Check if user is logged in
  let isLoggedIn = $derived(!!activeUser);

  // Check if this is the logged-in user's reaction and can be deleted
  let canDelete = $derived(
    userReactionEvent && activeUser && userReactionEvent.pubkey === activeUser.pubkey
  );

  function toggleReaction() {
    if (!isLoggedIn) return;

    if (userReacted && userReactionEvent) {
      deleteReaction(userReactionEvent, {
        relays: runtimeConfig.fallbackRelays || []
      })
        .then(() => showToast(m.reactions_remove_success(), 'success'))
        .catch((err) => {
          console.error('Failed to remove reaction:', err);
          showToast(m.reactions_remove_error(), 'error');
        });
    } else {
      reactionsStore.react(event, emoji);
    }
  }

  function handleDelete() {
    if (!canDelete) return;
    deleteReaction(userReactionEvent, {
      relays: runtimeConfig.fallbackRelays || []
    })
      .then(() => showToast(m.reactions_remove_success(), 'success'))
      .catch((err) => {
        console.error('Failed to delete reaction:', err);
        showToast(m.reactions_remove_error(), 'error');
      });
  }
</script>

<button
  type="button"
  onclick={toggleReaction}
  onmouseenter={() => (isHovering = true)}
  onmouseleave={() => (isHovering = false)}
  disabled={!isLoggedIn}
  data-testid="reaction-button"
  data-emoji={emoji}
  data-count={count}
  data-user-reacted={userReacted}
  class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition-all duration-200 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 {userReacted
    ? 'border-primary/40 bg-primary/10 text-primary hover:border-primary/60 hover:bg-primary/15'
    : 'border-base-content/20 bg-base-200/50 text-base-content/70 hover:border-base-content/30 hover:bg-base-200'}"
>
  {#if emojiUrl}
    <img src={emojiUrl} alt={emoji} title={emoji} class="inline h-5 w-5 object-contain" />
  {:else}
    <span class="text-base leading-none">{emoji}</span>
  {/if}
  {#if count > 0}
    <span class="text-xs font-medium">{count}</span>
  {/if}

  {#if canDelete && isHovering}
    <span
      role="button"
      tabindex="0"
      onclick={(e) => {
        e.stopPropagation();
        handleDelete();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleDelete();
        }
      }}
      class="ml-0.5 inline-flex cursor-pointer items-center transition-opacity"
      aria-label={m.reactions_delete_title()}
    >
      <TrashIcon class="h-3 w-3 text-error transition-colors hover:text-error/80" />
    </span>
  {/if}
</button>
