<script>
  /**
   * ReactionPicker - Modal wrapper around EmojiPicker for adding reactions
   * @component
   */
  import { reactionsStore } from '$lib/stores/reactions.svelte.js';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';
  import { CloseIcon } from '$lib/components/icons';
  import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {any} */
  let { event, onClose } = $props();

  let loading = $state(false);

  const getUserEmojiSets = useUserEmojiSets();
  let customEmojiSets = $derived(getUserEmojiSets());

  /**
   * @param {string} emoji
   */
  async function selectEmoji(emoji) {
    if (loading) return;

    loading = true;
    try {
      await reactionsStore.react(event, emoji);
      onClose();
    } catch (error) {
      console.error('Failed to add reaction:', error);
    } finally {
      loading = false;
    }
  }

  /**
   * @param {{ shortcode: string, url: string }} emoji
   */
  async function selectCustomEmoji(emoji) {
    if (loading) return;

    loading = true;
    try {
      await reactionsStore.react(event, emoji);
      onClose();
    } catch (error) {
      console.error('Failed to add custom reaction:', error);
    } finally {
      loading = false;
    }
  }

  /**
   * @param {MouseEvent} e
   */
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<!-- Modal backdrop -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
  onclick={handleBackdropClick}
  role="presentation"
  data-testid="reaction-picker"
>
  <!-- Modal content -->
  <div class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-base-200 shadow-xl">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-base-300 p-4">
      <h3 class="text-lg font-semibold text-base-content">{m.reactions_picker_title()}</h3>
      <button
        type="button"
        onclick={onClose}
        class="p-1 text-base-content/60 transition-colors hover:text-base-content"
        aria-label="Close"
      >
        <CloseIcon class_="w-5 h-5" />
      </button>
    </div>

    {#if loading}
      <div class="flex items-center justify-center p-8">
        <span class="loading loading-md loading-spinner"></span>
      </div>
    {:else}
      <EmojiPicker onSelect={selectEmoji} {customEmojiSets} onSelectCustom={selectCustomEmoji} />
    {/if}
  </div>
</div>
