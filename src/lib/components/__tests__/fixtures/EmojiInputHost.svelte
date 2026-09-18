<!-- Test host for EmojiInput: binds `value`, mirrors it into an <output>, and
     exposes the picker path (insert) through buttons. -->
<script>
  import EmojiInput from '$lib/components/shared/EmojiInput.svelte';

  /** @type {{ initial?: string, customEmojiSets?: any[], multiline?: boolean, onSubmit?: () => void }} */
  let { initial = '', customEmojiSets = [], multiline = false, onSubmit = () => {} } = $props();
  let value = $state(initial);
  /** @type {any} */
  let input;
</script>

<EmojiInput
  bind:this={input}
  bind:value
  {customEmojiSets}
  {multiline}
  {onSubmit}
  placeholder="Nachricht"
  testid="emoji-input"
/>
<output data-testid="value">{value}</output>
<button
  type="button"
  data-testid="insert-custom"
  onclick={() => input.insert({ shortcode: 'cat_wow', url: 'https://x/cat.png' })}>custom</button
>
<button type="button" data-testid="insert-unicode" onclick={() => input.insert('😀')}
  >unicode</button
>
<button type="button" data-testid="clear" onclick={() => (value = '')}>clear</button>
