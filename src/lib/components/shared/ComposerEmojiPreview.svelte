<!--
  ComposerEmojiPreview
  A chat composer is a plain text field, so a picked NIP-30 custom emoji can
  only sit there as `:shortcode:` — the bubble renders the image later, the
  writer never sees it (laoc, 2026-09-17). This strip shows the image for
  every picked shortcode that is still in the text, each with a remove
  button, so what will be sent is visible before sending. Shortcodes the
  writer deleted by hand drop out on their own; `picks` is the composer's
  pick map (shortcode → {shortcode, url}), unique by construction.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   text: string,
   *   picks: Record<string, { shortcode: string, url: string }>,
   *   onRemove?: (shortcode: string) => void
   * }}
   */
  let { text, picks, onRemove = undefined } = $props();

  const shown = $derived(
    Object.values(picks).filter((emoji) => text.includes(`:${emoji.shortcode}:`))
  );
</script>

{#if shown.length > 0}
  <div class="flex flex-wrap items-center gap-1 px-3 py-1" data-testid="composer-emoji-preview">
    {#each shown as emoji (emoji.shortcode)}
      <span
        class="inline-flex items-center gap-1 rounded-full bg-base-100 py-0.5 pr-1 pl-2 text-xs shadow-sm"
        data-testid="composer-emoji-chip"
      >
        <img
          src={emoji.url}
          alt=":{emoji.shortcode}:"
          class="h-5 w-5 object-contain"
          loading="lazy"
        />
        <span class="text-base-content/70">:{emoji.shortcode}:</span>
        {#if onRemove}
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-xs"
            aria-label={m.composer_emoji_remove({ shortcode: emoji.shortcode })}
            onclick={() => onRemove?.(emoji.shortcode)}
          >
            ✕
          </button>
        {/if}
      </span>
    {/each}
  </div>
{/if}
