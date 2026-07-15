<!--
  AncestorChain Component
  Bluesky-style vertical chain of compact ancestor comment cards.
  Shows the path from root to the focused comment's parent.
-->

<script>
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';

  import { generateAuthorColorRGB, profileLink } from '$lib/helpers/nostrUtils';
  import { resolve } from '$app/paths';

  /**
   * @typedef {Object} AncestorChainProps
   * @property {any[]} ancestors - Comment objects from root to parent of focused (exclusive of focused)
   * @property {(id: string) => void} [onAncestorClick] - Callback when an ancestor card is clicked
   */

  /** @type {AncestorChainProps} */
  let { ancestors, onAncestorClick } = $props();
</script>

{#if ancestors.length > 0}
  <div class="ancestor-chain" data-testid="ancestor-chain">
    {#each ancestors as ancestor, i (ancestor.id)}
      {@const getProfile = useUserProfile(() => ancestor.pubkey)}
      {@const profile = getProfile()}
      {@const displayName = getDisplayName(profile) || ancestor.pubkey.slice(0, 8) + '...'}
      {@const timestamp = formatRelativeTime(ancestor.created_at)}
      {@const ancestorRgb = generateAuthorColorRGB(ancestor.pubkey)}
      {@const ancestorBg = `rgba(${ancestorRgb.r},${ancestorRgb.g},${ancestorRgb.b},0.07)`}

      <!-- Ancestor card -->
      <div
        role="button"
        tabindex="0"
        class="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-base-200"
        style="background-color: {ancestorBg}"
        onclick={(e) => {
          if (e.target instanceof HTMLElement && e.target.closest('a')) return;
          onAncestorClick?.(ancestor.id);
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAncestorClick?.(ancestor.id);
          }
        }}
        data-testid="ancestor-card"
      >
        <!-- Avatar -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <span class="mt-0.5 flex-shrink-0" onclick={(e) => e.stopPropagation()}>
          <ProfileAvatar pubkey={ancestor.pubkey} size="xs" linkToProfile />
        </span>

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <a
              href={resolve(profileLink(ancestor.pubkey))}
              class="truncate text-xs font-semibold text-base-content hover:underline"
            >
              {displayName}
            </a>
            <span class="shrink-0 text-xs text-base-content/40">{timestamp}</span>
          </div>
          {#if ancestor.content}
            <p class="mt-0.5 text-xs text-base-content/60">{ancestor.content}</p>
          {/if}
        </div>
      </div>

      <!-- Connector line between ancestors -->
      {#if i < ancestors.length - 1}
        <div class="ml-[22px] h-2 border-l-2 border-base-content/20"></div>
      {/if}
    {/each}

    <!-- Final connector into focused comment -->
    <div class="ml-[22px] h-3 border-l-2 border-base-content/20"></div>
  </div>
{/if}
