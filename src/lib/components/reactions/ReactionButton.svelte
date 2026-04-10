<script>
  /**
   * ReactionButton - Individual reaction button with who-reacted popover
   * Shows emoji and count, highlights if user reacted
   * @component
   */
  import { reactionsStore } from '$lib/stores/reactions.svelte.js';
  import { TrashIcon } from '$lib/components/icons';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { deleteReaction } from '$lib/helpers/reactions.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';
  import ReactionReactorsList from './ReactionReactorsList.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {any} */
  let {
    event,
    emoji,
    count = 0,
    userReacted = false,
    userReactionEvent = null,
    emojiUrl = null,
    reactors = []
  } = $props();

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

<HoverCard enterDelay={300} leaveDelay={200} fixed>
  {#snippet trigger()}
    <button
      type="button"
      onclick={toggleReaction}
      disabled={!isLoggedIn}
      data-testid="reaction-button"
      data-emoji={emoji}
      data-count={count}
      data-user-reacted={userReacted}
      class="btn gap-1 rounded-full btn-ghost btn-xs {userReacted
        ? 'btn-active border-primary/40 text-primary'
        : 'border-base-content/20'}"
    >
      {#if emojiUrl}
        <img src={emojiUrl} alt={emoji} title={emoji} class="inline h-4 w-4 object-contain" />
      {:else}
        <span class="text-sm leading-none">{emoji}</span>
      {/if}
      {#if count > 0}
        <span class="text-xs font-medium">{count}</span>
      {/if}

      {#if canDelete}
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
          class="ml-0.5 inline-flex cursor-pointer items-center"
          aria-label={m.reactions_delete_title()}
        >
          <TrashIcon class="h-3 w-3 text-error transition-colors hover:text-error/80" />
        </span>
      {/if}
    </button>
  {/snippet}

  {#snippet content()}
    {#if reactors.length > 0}
      <ReactionReactorsList {reactors} {emoji} {emojiUrl} />
    {/if}
  {/snippet}
</HoverCard>
