<script>
  /**
   * AddReactionButton - Plus button that opens the emoji picker
   * @component
   */
  import ReactionPicker from './ReactionPicker.svelte';
  import { SmilePlusIcon } from '$lib/components/icons';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {any} */
  let { event } = $props();

  let showPicker = $state(false);

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
</script>

<button
  type="button"
  onclick={() => isLoggedIn && (showPicker = true)}
  disabled={!isLoggedIn}
  class="inline-flex items-center gap-1 rounded-full border border-base-content/20 px-2.5 py-1 text-sm text-base-content/50 transition-all hover:scale-105 hover:border-base-content/30 hover:bg-base-200 hover:text-base-content/70 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
  title={isLoggedIn ? m.reactions_add_reaction_title() : m.reactions_login_required()}
  data-testid="add-reaction-btn"
>
  <SmilePlusIcon class="h-4 w-4" />
</button>

{#if showPicker}
  <ReactionPicker {event} onClose={() => (showPicker = false)} />
{/if}
