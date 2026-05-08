<script>
  /**
   * AddReactionButton - Plus button that opens the emoji picker
   * @component
   */
  import ReactionPicker from './ReactionPicker.svelte';
  import { SmilePlusIcon } from '$lib/components/icons';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   event?: any,
   *   onPick?: (emoji: string | { shortcode: string, url: string }) => void
   * }}
   */
  let { event, onPick } = $props();

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
  class="btn rounded-full border-base-content/20 text-base-content/70 btn-ghost btn-xs"
  title={isLoggedIn ? m.reactions_add_reaction_title() : m.reactions_login_required()}
  data-testid="add-reaction-btn"
>
  <SmilePlusIcon class="h-4 w-4" />
</button>

{#if showPicker}
  <ReactionPicker {event} onClose={() => (showPicker = false)} {onPick} />
{/if}
