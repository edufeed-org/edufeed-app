<script>
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getProfilePicture } from 'applesauce-core/helpers';

  /**
   * @typedef {Object} Props
   * @property {string[]} pubkeys - Hex pubkeys to display
   * @property {string[]} selected - Hex pubkeys currently selected
   * @property {(pubkey: string) => void} onToggle
   * @property {'rail' | 'compact'} [variant]
   */

  /** @type {Props} */
  let { pubkeys, selected, onToggle, variant = 'rail' } = $props();

  const getProfiles = useProfileMap(() => pubkeys);

  function displayName(/** @type {string} */ pubkey) {
    const p = getProfiles().get(pubkey);
    return p?.name || p?.display_name || pubkey.slice(0, 8);
  }

  function avatarUrl(/** @type {string} */ pubkey) {
    const p = getProfiles().get(pubkey);
    try {
      return p ? getProfilePicture(p, undefined) : undefined;
    } catch {
      return undefined;
    }
  }
</script>

{#if pubkeys.length > 0}
  <div
    data-testid="featured-authors"
    class={variant === 'rail'
      ? 'flex flex-wrap gap-3 overflow-x-auto md:overflow-visible'
      : 'grid grid-cols-3 gap-2 sm:grid-cols-4'}
  >
    {#each pubkeys as pubkey (pubkey)}
      {@const isSelected = selected.includes(pubkey)}
      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={displayName(pubkey)}
        onclick={() => onToggle(pubkey)}
        class="flex flex-col items-center gap-1 rounded-lg p-2 transition
          {isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-base-200'}"
      >
        <div class="avatar">
          <div class="w-12 rounded-full bg-base-300">
            {#if avatarUrl(pubkey)}
              <img src={avatarUrl(pubkey)} alt="" />
            {/if}
          </div>
        </div>
        <span class="max-w-[6rem] truncate text-xs">{displayName(pubkey)}</span>
      </button>
    {/each}
  </div>
{/if}
