<script>
  /**
   * Stand-in for the lazily loaded CallEmojiPicker: one unicode, one custom
   * pick. `data-sets` records the packs the host handed over.
   */
  let { onPick, customEmojiSets = undefined } = $props();
</script>

<div
  data-testid="call-emoji-picker-stub"
  data-sets={customEmojiSets === undefined ? undefined : JSON.stringify(customEmojiSets)}
>
  <button type="button" onclick={() => onPick('🫶')}>pick-unicode</button>
  <button type="button" onclick={() => onPick({ shortcode: 'parrot', url: 'https://x.org/p.gif' })}
    >pick-custom</button
  >
</div>
