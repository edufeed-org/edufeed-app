<script>
  /**
   * EmojiPicker - Reusable emoji grid with search and categories
   * Supports unicode emojis and optional NIP-30 custom emoji packs
   * Consumer provides the container (modal, dropdown, etc.)
   * @component
   */
  import { emojiMetadata } from '$lib/data/emojiMetadata.js';
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

  const emojiCategories = $derived.by(() => [
    {
      name: m.reactions_category_smileys(),
      emojis: [
        '😀',
        '😃',
        '😄',
        '😁',
        '😆',
        '😅',
        '🤣',
        '😂',
        '🙂',
        '🙃',
        '😉',
        '😊',
        '😇',
        '🥰',
        '😍',
        '🤩',
        '😘',
        '😗',
        '😚',
        '😙',
        '🥲',
        '😋',
        '😛',
        '😜',
        '🤪',
        '😝',
        '🤑',
        '🤗',
        '🤭',
        '🤫',
        '🤔',
        '🤐',
        '🤨',
        '😐',
        '😑',
        '😶',
        '😏',
        '😒',
        '🙄',
        '😬',
        '🤥',
        '😌',
        '😔',
        '😪',
        '🤤',
        '😴',
        '😷',
        '🤒',
        '🤕',
        '🤢',
        '🤮',
        '🤧',
        '🥵',
        '🥶',
        '😶‍🌫️',
        '😵',
        '😵‍💫',
        '🤯',
        '🤠',
        '🥳',
        '🥸',
        '😎',
        '🤓',
        '🧐',
        '😕',
        '😟',
        '🙁',
        '☹️',
        '😮',
        '😯',
        '😲',
        '😳',
        '🥺',
        '😦',
        '😧',
        '😨',
        '😰',
        '😥',
        '😢',
        '😭',
        '😱',
        '😖',
        '😣',
        '😞',
        '😓',
        '😩',
        '😫',
        '🥱',
        '😤',
        '😡',
        '😠',
        '🤬',
        '😈',
        '👿',
        '💀',
        '☠️',
        '💩',
        '🤡',
        '👹',
        '👺',
        '👻',
        '👽',
        '👾',
        '🤖',
        '😺',
        '😸',
        '😹',
        '😻',
        '😼',
        '😽',
        '🙀',
        '😿',
        '😾'
      ]
    },
    {
      name: m.reactions_category_gestures(),
      emojis: [
        '👋',
        '🤚',
        '🖐️',
        '✋',
        '🖖',
        '👌',
        '🤌',
        '🤏',
        '✌️',
        '🤞',
        '🤟',
        '🤘',
        '🤙',
        '👈',
        '👉',
        '👆',
        '🖕',
        '👇',
        '☝️',
        '👍',
        '👎',
        '✊',
        '👊',
        '🤛',
        '🤜',
        '👏',
        '🙌',
        '👐',
        '🤲',
        '🤝',
        '🙏'
      ]
    },
    {
      name: m.reactions_category_hearts(),
      emojis: [
        '❤️',
        '🧡',
        '💛',
        '💚',
        '💙',
        '💜',
        '🖤',
        '🤍',
        '🤎',
        '💔',
        '❣️',
        '💕',
        '💞',
        '💓',
        '💗',
        '💖',
        '💘',
        '💝',
        '💟'
      ]
    },
    {
      name: m.reactions_category_celebrations(),
      emojis: [
        '🎉',
        '🎊',
        '🎈',
        '🎁',
        '🏆',
        '🥇',
        '🥈',
        '🥉',
        '⭐',
        '🌟',
        '✨',
        '💫',
        '🔥',
        '💥',
        '💯',
        '✅',
        '☑️'
      ]
    },
    {
      name: m.reactions_category_nature(),
      emojis: [
        '🌸',
        '🌺',
        '🌼',
        '🌻',
        '🌞',
        '🌝',
        '🌛',
        '🌜',
        '🌚',
        '🌕',
        '🌖',
        '🌗',
        '🌘',
        '🌑',
        '🌒',
        '🌓',
        '🌔',
        '🌙',
        '⭐',
        '🌟',
        '✨',
        '⚡',
        '☄️',
        '💥',
        '🔥',
        '🌪️',
        '🌈',
        '☀️',
        '🌤️',
        '⛅',
        '🌥️',
        '☁️',
        '🌦️',
        '🌧️',
        '⛈️',
        '🌩️',
        '🌨️',
        '❄️',
        '☃️',
        '⛄',
        '🌬️',
        '💨'
      ]
    },
    {
      name: m.reactions_category_food(),
      emojis: [
        '🍎',
        '🍊',
        '🍋',
        '🍌',
        '🍉',
        '🍇',
        '🍓',
        '🫐',
        '🍈',
        '🍒',
        '🍑',
        '🥭',
        '🍍',
        '🥥',
        '🥝',
        '🍅',
        '🍆',
        '🥑',
        '🥦',
        '🥬',
        '🥒',
        '🌶️',
        '🫑',
        '🌽',
        '🥕',
        '🫒',
        '🧄',
        '🧅',
        '🥔',
        '🍠',
        '🥐',
        '🥯',
        '🍞',
        '🥖',
        '🥨',
        '🧀',
        '🥚',
        '🍳',
        '🧈',
        '🥞',
        '🧇',
        '🥓',
        '🥩',
        '🍗',
        '🍖',
        '🦴',
        '🌭',
        '🍔',
        '🍟',
        '🍕',
        '🫓',
        '🥪',
        '🥙',
        '🧆',
        '🌮',
        '🌯',
        '🫔',
        '🥗',
        '🥘',
        '🫕',
        '🥫',
        '🍝',
        '🍜',
        '🍲',
        '🍛',
        '🍣',
        '🍱',
        '🥟',
        '🦪',
        '🍤',
        '🍙',
        '🍚',
        '🍘',
        '🍥',
        '🥠',
        '🥮',
        '🍢',
        '🍡',
        '🍧',
        '🍨',
        '🍦',
        '🥧',
        '🧁',
        '🍰',
        '🎂',
        '🍮',
        '🍭',
        '🍬',
        '🍫',
        '🍿',
        '🍩',
        '🍪',
        '🌰',
        '🥜',
        '🍯',
        '🥛',
        '🍼',
        '🫖',
        '☕',
        '🍵',
        '🧃',
        '🥤',
        '🧋',
        '🍶',
        '🍺',
        '🍻',
        '🥂',
        '🍷',
        '🥃',
        '🍸',
        '🍹',
        '🧉',
        '🍾',
        '🧊'
      ]
    },
    {
      name: m.reactions_category_activities(),
      emojis: [
        '⚽',
        '🏀',
        '🏈',
        '⚾',
        '🥎',
        '🎾',
        '🏐',
        '🏉',
        '🥏',
        '🎱',
        '🪀',
        '🏓',
        '🏸',
        '🏒',
        '🏑',
        '🥍',
        '🏏',
        '🪃',
        '🥅',
        '⛳',
        '🪁',
        '🏹',
        '🎣',
        '🤿',
        '🥊',
        '🥋',
        '🎽',
        '🛹',
        '🛼',
        '🛷',
        '⛸️',
        '🥌',
        '🎿',
        '⛷️',
        '🏂',
        '🪂',
        '🏋️',
        '🤼',
        '🤸',
        '🤺',
        '⛹️',
        '🤾',
        '🏌️',
        '🏇',
        '🧘',
        '🏊',
        '🤽',
        '🚣',
        '🧗',
        '🚵',
        '🚴',
        '🏆',
        '🥇',
        '🥈',
        '🥉',
        '🏅',
        '🎖️',
        '🎗️',
        '🏵️',
        '🎫',
        '🎟️',
        '🎪',
        '🤹',
        '🎭',
        '🎨',
        '🎬',
        '🎤',
        '🎧',
        '🎼',
        '🎹',
        '🥁',
        '🪘',
        '🎷',
        '🎺',
        '🪗',
        '🎸',
        '🪕',
        '🎻',
        '🎲',
        '♟️',
        '🎯',
        '🎳',
        '🎮',
        '🎰',
        '🧩'
      ]
    },
    {
      name: m.reactions_category_objects(),
      emojis: [
        '💡',
        '🔦',
        '🕯️',
        '🪔',
        '🧯',
        '🛢️',
        '💸',
        '💵',
        '💴',
        '💶',
        '💷',
        '🪙',
        '💰',
        '💳',
        '🪪',
        '💎',
        '⚖️',
        '🪜',
        '🧰',
        '🪛',
        '🔧',
        '🔨',
        '⚒️',
        '🛠️',
        '⛏️',
        '🪚',
        '🔩',
        '⚙️',
        '🪤',
        '🧱',
        '⛓️',
        '🧲',
        '🔫',
        '💣',
        '🧨',
        '🪓',
        '🔪',
        '🗡️',
        '⚔️',
        '🛡️',
        '🚬',
        '⚰️',
        '🪦',
        '⚱️',
        '🏺',
        '🔮',
        '📿',
        '🧿',
        '💈',
        '⚗️',
        '🔭',
        '🔬',
        '🕳️',
        '🩹',
        '🩺',
        '💊',
        '💉',
        '🩸',
        '🧬',
        '🦠',
        '🧫',
        '🧪',
        '🌡️',
        '🧹',
        '🪠',
        '🧺',
        '🧻',
        '🪣',
        '🧼',
        '🪥',
        '🧽',
        '🧴',
        '🛎️',
        '🔑',
        '🗝️',
        '🚪',
        '🪑',
        '🛋️',
        '🛏️',
        '🛌',
        '🧸',
        '🪆',
        '🖼️',
        '🪞',
        '🪟',
        '🛍️',
        '🛒',
        '🎁',
        '🎈',
        '🎏',
        '🎀',
        '🪄',
        '🪅',
        '🎊',
        '🎉',
        '🎎',
        '🏮',
        '🎐',
        '🧧',
        '✉️',
        '📩',
        '📨',
        '📧',
        '💌',
        '📥',
        '📤',
        '📦',
        '🏷️',
        '🪧',
        '📪',
        '📫',
        '📬',
        '📭',
        '📮',
        '📯',
        '📜',
        '📃',
        '📄',
        '📑',
        '🧾',
        '📊',
        '📈',
        '📉',
        '🗒️',
        '🗓️',
        '📆',
        '📅',
        '🗑️',
        '📇',
        '🗃️',
        '🗳️',
        '🗄️',
        '📋',
        '📁',
        '📂',
        '🗂️',
        '🗞️',
        '📰',
        '📓',
        '📔',
        '📒',
        '📕',
        '📗',
        '📘',
        '📙',
        '📚',
        '📖',
        '🔖',
        '🧷',
        '🔗',
        '📎',
        '🖇️',
        '📐',
        '📏',
        '🧮',
        '📌',
        '📍',
        '✂️',
        '🖊️',
        '🖋️',
        '✒️',
        '🖌️',
        '🖍️',
        '📝',
        '✏️',
        '🔍',
        '🔎',
        '🔏',
        '🔐',
        '🔒',
        '🔓'
      ]
    }
  ]);

  /** Filter custom emoji packs by search query */
  const filteredCustomSets = $derived.by(() => {
    if (!customEmojiSets || customEmojiSets.length === 0) return [];
    if (!searchQuery.trim()) return customEmojiSets;

    const query = searchQuery.toLowerCase();
    return customEmojiSets
      .map((pack) => ({
        ...pack,
        emojis: pack.emojis.filter((e) => e.shortcode.toLowerCase().includes(query))
      }))
      .filter((pack) => pack.emojis.length > 0);
  });

  const filteredCategories = $derived.by(() => {
    if (!searchQuery.trim()) return emojiCategories;

    const query = searchQuery.toLowerCase();
    return emojiCategories
      .map((category) => ({
        ...category,
        emojis: category.emojis.filter((/** @type {string} */ emoji) => {
          const metadata = /** @type {string[] | undefined} */ (
            emojiMetadata[/** @type {keyof typeof emojiMetadata} */ (emoji)]
          );
          if (!metadata) return false;
          return metadata.some((/** @type {string} */ keyword) =>
            keyword.toLowerCase().includes(query)
          );
        })
      }))
      .filter((category) => category.emojis.length > 0);
  });
</script>

<!-- Search -->
<div class="border-b border-base-300 p-3">
  <input
    type="text"
    bind:value={searchQuery}
    placeholder={m.reactions_picker_search_placeholder()}
    class="input input-sm w-full bg-base-100"
    data-testid="emoji-search"
  />
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

  <!-- Unicode emoji categories -->
  {#each filteredCategories as category (category.name)}
    <div class="mb-4">
      <h4 class="mb-1 text-xs font-medium text-base-content/60">{category.name}</h4>
      <div class="grid grid-cols-8 gap-1">
        {#each category.emojis as emoji (emoji)}
          <button
            type="button"
            onclick={() => onSelect(emoji)}
            class="rounded p-1 text-xl transition-colors hover:bg-base-300"
            title={emoji}
            data-testid="emoji-option"
            data-emoji={emoji}
          >
            {emoji}
          </button>
        {/each}
      </div>
    </div>
  {/each}
</div>
