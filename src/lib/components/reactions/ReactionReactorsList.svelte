<!--
  ReactionReactorsList - Compact list of users who reacted with a specific emoji.
  Used inside HoverCard popover on ReactionButton.
-->

<script>
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import * as m from '$lib/paraglide/messages';

  const MAX_DISPLAY = 10;

  /**
   * @typedef {Object} Props
   * @property {string[]} reactors - Pubkeys of users who reacted
   * @property {string} emoji - The emoji they reacted with
   * @property {string | null} [emojiUrl] - Custom emoji image URL
   */

  /** @type {Props} */
  let { reactors, emoji, emojiUrl = null } = $props();

  let uniqueReactors = $derived([...new Set(reactors)]);

  const getProfiles = useProfileMap(() => uniqueReactors);

  let displayReactors = $derived(uniqueReactors.slice(0, MAX_DISPLAY));
  let overflow = $derived(uniqueReactors.length - MAX_DISPLAY);
  let profiles = $derived(getProfiles());
</script>

<div class="w-48 p-3">
  <!-- Header -->
  <div class="mb-2 flex items-center gap-1.5 text-sm font-medium text-base-content">
    {#if emojiUrl}
      <img src={emojiUrl} alt={emoji} class="inline h-5 w-5 object-contain" />
    {:else}
      <span class="text-base">{emoji}</span>
    {/if}
    <span>{m.reactions_reacted_with({ emoji: '' })}</span>
  </div>

  <!-- Reactor list -->
  <ul class="space-y-1.5">
    {#each displayReactors as pubkey (pubkey)}
      {@const profile = profiles.get(pubkey)}
      <li class="flex items-center gap-2">
        <ProfileAvatar {pubkey} {profile} size="xs" linkToProfile showHoverCard />
        <a
          href={resolve(`/p/${pubkey}`)}
          class="truncate text-sm text-base-content/80 hover:underline"
        >
          {getDisplayName(profile) || `${pubkey.slice(0, 8)}...`}
        </a>
      </li>
    {/each}
  </ul>

  {#if overflow > 0}
    <p class="mt-1.5 text-xs text-base-content/50">
      {m.reactions_and_others({ count: overflow })}
    </p>
  {/if}
</div>
