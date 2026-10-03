<!--
  CallEmojiPicker — the app's full EmojiPicker (unicode + the user's NIP-30
  custom emoji sets) sized for the call's reactions popover. Loaded lazily
  by GroupCallStage on "Weitere Emojis", so neither the picker nor the emoji
  stores enter the stage's (or any route's) static graph. A guest has no
  emoji sets: the unicode picker alone.
-->
<script>
  import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';

  /** @type {{ onPick: (emoji: string | { shortcode: string, url: string }) => void }} */
  let { onPick } = $props();

  const getUserEmojiSets = useUserEmojiSets();
  const customEmojiSets = $derived(getUserEmojiSets());
</script>

<div
  class="flex h-80 w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-box bg-base-100"
  data-testid="call-emoji-picker"
>
  <EmojiPicker onSelect={(emoji) => onPick(emoji)} {customEmojiSets} onSelectCustom={onPick} />
</div>
