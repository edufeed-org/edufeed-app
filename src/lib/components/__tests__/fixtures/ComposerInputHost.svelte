<!-- Test host for ComposerInput: binds `value`, mirrors it into an <output>, and
     exposes the picker path (insert) and the toolbar path (getSelection /
     replaceRange) through buttons. -->
<script>
  import ComposerInput from '$lib/components/shared/ComposerInput.svelte';

  /**
   * @type {{
   *   initial?: string,
   *   customEmojiSets?: any[],
   *   multiline?: boolean,
   *   minHeight?: string,
   *   submitOnEnter?: boolean,
   *   placement?: 'above' | 'caret',
   *   onSubmit?: () => void
   * }}
   */
  let {
    initial = '',
    customEmojiSets = [],
    multiline = false,
    minHeight = undefined,
    submitOnEnter = true,
    placement = 'above',
    onSubmit = () => {}
  } = $props();
  let value = $state(initial);
  let selection = $state('');
  /** @type {any} */
  let input;

  function wrapBold() {
    const s = input.getSelection();
    const selected = value.slice(s.start, s.end) || 'bold text';
    input.replaceRange(s.start, s.end, `**${selected}**`);
  }
</script>

<ComposerInput
  bind:this={input}
  bind:value
  {customEmojiSets}
  {multiline}
  {minHeight}
  {submitOnEnter}
  {placement}
  {onSubmit}
  placeholder="Nachricht"
  testid="emoji-input"
/>
<output data-testid="value">{value}</output>
<output data-testid="selection">{selection}</output>
<button
  type="button"
  data-testid="insert-custom"
  onclick={() => input.insert({ shortcode: 'cat_wow', url: 'https://x/cat.png' })}>custom</button
>
<button type="button" data-testid="insert-unicode" onclick={() => input.insert('😀')}
  >unicode</button
>
<button type="button" data-testid="clear" onclick={() => (value = '')}>clear</button>
<button
  type="button"
  data-testid="read-selection"
  onclick={() => (selection = JSON.stringify(input.getSelection()))}>sel</button
>
<button type="button" data-testid="wrap-bold" onclick={wrapBold}>bold</button>
