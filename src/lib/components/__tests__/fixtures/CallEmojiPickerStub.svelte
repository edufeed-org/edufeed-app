<script>
  /** Stand-in for the lazily loaded CallEmojiPicker: one unicode, one custom pick. */
  let { onPick } = $props();
</script>

<div data-testid="call-emoji-picker-stub">
  <button type="button" onclick={() => onPick('🫶')}>pick-unicode</button>
  <button type="button" onclick={() => onPick({ shortcode: 'parrot', url: 'https://x.org/p.gif' })}
    >pick-custom</button
  >
</div>
