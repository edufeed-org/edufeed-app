<!--
  CallEmojiPicker — the app's full EmojiPicker (unicode + the user's NIP-30
  custom emoji sets) sized for the call's popovers. Loaded lazily by
  GroupCallStage ("Weitere Emojis") and CallChatPanel (the composer's emoji
  button), so neither the picker nor the emoji stores enter the stage's (or
  any route's) static graph. A guest has no emoji sets: the unicode picker
  alone.

  A host that already holds the user's packs (the chat panel, whose `:xx`
  autocomplete needs them anyway) passes them in; otherwise the picker loads
  them itself (the stage keeps the emoji stores out of its own graph).
-->
<script>
  import { untrack } from 'svelte';
  import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';

  /**
   * @type {{
   *   onPick: (emoji: string | { shortcode: string, url: string }) => void,
   *   customEmojiSets?: import('$lib/stores/user-emoji-sets.svelte.js').EmojiPack[]
   * }}
   */
  let { onPick, customEmojiSets: hostSets = undefined } = $props();

  // Decided once at mount: a host either owns the packs or it does not.
  const getOwnSets = untrack(() => hostSets === undefined) ? useUserEmojiSets() : null;
  const customEmojiSets = $derived(getOwnSets ? getOwnSets() : (hostSets ?? []));
</script>

<div
  class="flex h-80 w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-box bg-base-100"
  data-testid="call-emoji-picker"
>
  <EmojiPicker onSelect={(emoji) => onPick(emoji)} {customEmojiSets} onSelectCustom={onPick} />
</div>
