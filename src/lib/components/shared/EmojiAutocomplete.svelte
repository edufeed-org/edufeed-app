<!--
  EmojiAutocomplete — presentational suggestion list for ComposerInput's `:`
  autocomplete. ComposerInput owns detection and keyboard handling; this only
  renders candidates and reports a pick. mousedown (not click) so the pick
  wins the race against the editor losing focus — same as MentionAutocomplete.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   candidates: import('$lib/helpers/emoji-autocomplete.js').EmojiHit[],
   *   highlightIndex: number,
   *   onSelect: (hit: import('$lib/helpers/emoji-autocomplete.js').EmojiHit) => void
   * }}
   */
  let { candidates = [], highlightIndex = 0, onSelect } = $props();

  /** @param {import('$lib/helpers/emoji-autocomplete.js').EmojiHit} hit */
  const keyOf = (hit) => (hit.type === 'custom' ? `custom:${hit.shortcode}` : `u:${hit.char}`);
</script>

{#if candidates.length > 0}
  <ul
    role="listbox"
    aria-label={m.emoji_suggestions_label()}
    class="absolute bottom-full left-0 z-40 mb-1 max-h-60 w-full max-w-[calc(100vw-2rem)] min-w-64 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
    data-testid="emoji-suggestions"
  >
    {#each candidates as hit, i (keyOf(hit))}
      <li
        role="option"
        aria-selected={i === highlightIndex}
        class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm {i ===
        highlightIndex
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-base-300/60'}"
        onmousedown={(e) => {
          e.preventDefault();
          onSelect(hit);
        }}
      >
        {#if hit.type === 'custom'}
          <img src={hit.url} alt="" class="h-5 w-5 shrink-0 object-contain" loading="lazy" />
          <span class="min-w-0 flex-1 truncate">:{hit.shortcode}:</span>
          <span class="shrink-0 text-xs text-base-content/50">{hit.packName}</span>
        {:else}
          <span class="w-5 shrink-0 text-center text-lg leading-none">{hit.char}</span>
          <span class="min-w-0 flex-1 truncate">:{hit.name}:</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
