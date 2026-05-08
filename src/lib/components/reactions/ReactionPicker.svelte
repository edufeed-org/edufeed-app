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

  /**
   * @type {{
   *   event?: any,
   *   onClose: () => void,
   *   onPick?: (emoji: string | { shortcode: string, url: string }) => void
   * }}
   */
  let { event, onClose, onPick } = $props();

  const getUserEmojiSets = useUserEmojiSets();
  let customEmojiSets = $derived(getUserEmojiSets());

  /**
   * @param {string} emoji
   */
  function selectEmoji(emoji) {
    if (onPick) {
      onPick(emoji);
    } else {
      reactionsStore.react(event, emoji);
    }
    onClose();
  }

  /**
   * @param {{ shortcode: string, url: string }} emoji
   */
  function selectCustomEmoji(emoji) {
    if (onPick) {
      onPick(emoji);
    } else {
      reactionsStore.react(event, emoji);
    }
    onClose();
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
        aria-label={m.common_close()}
      >
        <CloseIcon class_="w-5 h-5" />
      </button>
    </div>

    <EmojiPicker onSelect={selectEmoji} {customEmojiSets} onSelectCustom={selectCustomEmoji} />
  </div>
</div>
