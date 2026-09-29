<script>
  /**
   * EmojiPicker - Reusable emoji grid with search, groups and skin tones
   * over the full unicode set for the current locale (Unicode 17 via the
   * generated datasets in src/lib/data/emoji/, see emoji-data.js), plus the
   * user's NIP-30 custom emoji packs above it. Search matches the locale's
   * CLDR keywords and the English `:shortcode:` vocabulary alike.
   * Consumer provides the container (modal, dropdown, etc.)
   * @component
   */
  import {
    EMOJI_GROUP_ORDER,
    SKIN_TONES,
    searchUnicodeEmojis,
    withSkinTone
  } from '$lib/helpers/emoji-data.js';
  import { getEmojiEntries, getSkinTone, setSkinTone } from '$lib/stores/emoji-data.svelte.js';
  import * as m from '$lib/paraglide/messages';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';

  /**
   * @typedef {{ shortcode: string, url: string }} CustomEmoji
   * @typedef {{ packName: string, emojis: CustomEmoji[] }} EmojiPack
   */

  /** @type {{
   *   onSelect: (emoji: string) => void,
   *   customEmojiSets?: EmojiPack[],
   *   onSelectCustom?: (emoji: CustomEmoji) => void
   * }} */
  let { onSelect, customEmojiSets = [], onSelectCustom } = $props();

  let searchQuery = $state('');
  const entries = $derived(getEmojiEntries());
  const skinTone = $derived(getSkinTone());
  const query = $derived(searchQuery.trim());

  /** Group names — a static switch, never `m[key]` (see CLAUDE.md, Paraglide budget).
   * @param {number} group emojibase group number */
  function groupName(group) {
    switch (group) {
      case 0:
        return m.emoji_group_smileys();
      case 1:
        return m.emoji_group_people();
      case 3:
        return m.emoji_group_animals();
      case 4:
        return m.emoji_group_food();
      case 5:
        return m.emoji_group_travel();
      case 6:
        return m.emoji_group_activities();
      case 7:
        return m.emoji_group_objects();
      case 8:
        return m.emoji_group_symbols();
      default:
        return m.emoji_group_flags();
    }
  }
  /** @param {number} tone */
  function toneName(tone) {
    switch (tone) {
      case 1:
        return m.emoji_skin_tone_light();
      case 2:
        return m.emoji_skin_tone_medium_light();
      case 3:
        return m.emoji_skin_tone_medium();
      case 4:
        return m.emoji_skin_tone_medium_dark();
      case 5:
        return m.emoji_skin_tone_dark();
      default:
        return m.emoji_skin_tone_none();
    }
  }
  /** the hand shown in the tone selector, in that tone */
  const TONE_SAMPLE = { u: '✋', g: 1, l: '', t: [], s: [], k: ['✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'] };

  /** Browsing view: one section per emojibase group, in picker order. */
  const groups = $derived.by(() =>
    EMOJI_GROUP_ORDER.map((g) => ({
      g,
      name: groupName(g),
      emojis: entries.filter((e) => e.g === g)
    })).filter((group) => group.emojis.length > 0)
  );

  /** Search view: one ranked list across all groups (null while browsing). */
  const results = $derived(query ? searchUnicodeEmojis(query, entries) : null);

  /** Custom emoji packs filtered by shortcode */
  const filteredCustomSets = $derived.by(() => {
    if (!customEmojiSets || customEmojiSets.length === 0) return [];
    if (!query) return customEmojiSets;
    const q = query.toLowerCase();
    return customEmojiSets
      .map((pack) => ({
        ...pack,
        emojis: pack.emojis.filter((e) => e.shortcode.toLowerCase().includes(q))
      }))
      .filter((pack) => pack.emojis.length > 0);
  });

  const sections = $derived(
    results
      ? results.length
        ? [{ g: -1, name: m.emoji_search_results(), emojis: results }]
        : []
      : groups
  );
  const nothingFound = $derived(
    !!query && filteredCustomSets.length === 0 && sections.length === 0
  );
</script>

<!-- Search + skin tone -->
<div class="flex items-center gap-2 border-b border-base-300 p-3">
  <input
    type="text"
    bind:value={searchQuery}
    placeholder={m.reactions_picker_search_placeholder()}
    class="input input-sm min-w-0 flex-1 bg-base-100"
    data-testid="emoji-search"
  />
  <select
    class="select w-auto shrink-0 bg-base-100 select-sm pr-8"
    aria-label={m.emoji_skin_tone_label()}
    title={m.emoji_skin_tone_label()}
    value={skinTone}
    onchange={(e) => setSkinTone(Number(/** @type {HTMLSelectElement} */ (e.currentTarget).value))}
    data-testid="emoji-skin-tone"
  >
    {#each SKIN_TONES as tone (tone)}
      <option value={tone}>{withSkinTone(TONE_SAMPLE, tone)} {toneName(tone)}</option>
    {/each}
  </select>
</div>

<!-- Emoji grid -->
<div class="flex-1 overflow-y-auto p-3">
  <!-- Custom emoji packs (above unicode) -->
  {#each filteredCustomSets as pack (pack.packName)}
    <div class="mb-4">
      <h4 class="mb-1 text-xs font-medium text-base-content/60">{pack.packName}</h4>
      <div class="grid grid-cols-8 gap-1">
        {#each pack.emojis as emoji (emoji.shortcode)}
          <button
            type="button"
            onclick={() => {
              if (onSelectCustom) {
                onSelectCustom(emoji);
              } else {
                onSelect(`:${emoji.shortcode}:`);
              }
            }}
            class="flex items-center justify-center rounded p-1 transition-colors hover:bg-base-300"
            title=":{emoji.shortcode}:"
            data-testid="custom-emoji-option"
          >
            <ImageWithFallback
              src={emoji.url}
              alt=":{emoji.shortcode}:"
              loading="lazy"
              fallbackType="generic"
              class="inline h-6 w-6 object-contain"
            />
          </button>
        {/each}
      </div>
    </div>
  {/each}

  <!-- Unicode emojis: groups while browsing, one ranked list while searching -->
  {#each sections as section (section.g)}
    <div class="mb-4">
      <h4 class="mb-1 text-xs font-medium text-base-content/60">{section.name}</h4>
      <div class="grid grid-cols-8 gap-1">
        {#each section.emojis as entry (entry.u)}
          {@const emoji = withSkinTone(entry, skinTone)}
          <button
            type="button"
            onclick={() => onSelect(emoji)}
            class="rounded p-1 text-xl leading-none transition-colors hover:bg-base-300"
            title={entry.l}
            data-testid="emoji-option"
            data-emoji={emoji}
          >
            {emoji}
          </button>
        {/each}
      </div>
    </div>
  {/each}

  {#if nothingFound}
    <p class="p-2 text-center text-sm text-base-content/60" data-testid="emoji-no-results">
      {m.emoji_search_no_results()}
    </p>
  {/if}
</div>
