<!--
  ProfileAvatar Component
  Displays user avatar with fallback options
  Can load profile internally or accept it as a prop
-->

<script>
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { getProfilePicture, getDisplayName } from 'applesauce-core/helpers';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import ImageWithFallback from './ImageWithFallback.svelte';
  import HoverCard from './HoverCard.svelte';
  import ProfileHoverCardContent from './ProfileHoverCardContent.svelte';
  import { profileLink } from '$lib/helpers/nostrUtils.js';

  /**
   * @typedef {Object} Props
   * @property {string} [pubkey] - User pubkey (optional - if not provided, uses active user)
   * @property {any} [profile] - Profile object (optional - if not provided, loads internally)
   * @property {'2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'} [size] - Avatar size
   * @property {'initial' | 'robohash'} [fallbackType] - Type of fallback to use
   * @property {boolean} [linkToProfile] - Wrap avatar in a link to the user's profile page
   * @property {boolean} [showHoverCard] - Show profile hover card on hover (defaults to linkToProfile && !!pubkey)
   * @property {string} [class] - Additional CSS classes
   * @property {'lazy' | 'eager'} [loading] - Image loading strategy (eager inside popovers)
   */

  /** @type {Props} */
  let {
    pubkey = undefined,
    profile = undefined,
    size = 'md',
    fallbackType = 'initial',
    linkToProfile = false,
    showHoverCard = undefined,
    class: className = '',
    loading = /** @type {'lazy' | 'eager'} */ ('lazy')
  } = $props();

  let effectiveShowHoverCard = $derived(showHoverCard ?? (linkToProfile && !!pubkey));

  // Load profile reactively when pubkey changes.
  // When profile prop is explicitly provided (even as null), skip self-loading — the parent manages it.
  // Otherwise, use eventStore.profile() which auto-loads via the unified eventLoader.
  let loadedProfile = $state(/** @type {any} */ (null));

  $effect(() => {
    // If profile is provided as prop, use it directly
    if (profile !== undefined) {
      loadedProfile = profile;
      return;
    }

    // Reset profile when pubkey changes
    loadedProfile = null;

    // Subscribe to eventStore.profile() — auto-loads via eventStore.eventLoader
    if (pubkey) {
      const sub = eventStore.profile(pubkey).subscribe((profileContent) => {
        loadedProfile = profileContent;
      });

      return () => sub.unsubscribe();
    }
  });

  // Size mappings
  const sizeClasses = {
    '2xs': 'w-4',
    xs: 'w-6',
    sm: 'w-8',
    md: 'w-10',
    lg: 'w-12',
    xl: 'w-16'
  };

  /** @type {Record<string, string>} */
  const sizeToProxy = {
    '2xs': 'avatar_sm',
    xs: 'avatar_sm',
    sm: 'avatar_sm',
    md: 'avatar_md',
    lg: 'avatar_lg',
    xl: 'avatar_lg'
  };

  // Get avatar URL
  let avatarUrl = $derived(getProfilePicture(loadedProfile));

  // Get display name for fallback
  let displayName = $derived(getDisplayName(loadedProfile));

  // Get fallback content
  let fallbackContent = $derived.by(() => {
    if (fallbackType === 'robohash' && pubkey) {
      return `https://robohash.org/${pubkey}`;
    }
    // Use initial letter fallback
    return displayName?.charAt(0).toUpperCase() || '?';
  });

  let showInitialFallback = $derived(fallbackType === 'initial' && !avatarUrl);
  let showRobohashFallback = $derived(fallbackType === 'robohash' && !avatarUrl);
</script>

{#snippet avatarContent()}
  <div class="not-prose {sizeClasses[size]} rounded-full">
    {#if avatarUrl}
      <ImageWithFallback
        src={avatarUrl}
        alt={displayName || m.profile_avatar_alt()}
        fallbackType="avatar"
        size={sizeToProxy[size]}
        {loading}
        class="h-full w-full rounded-full object-cover"
      />
    {:else if showRobohashFallback}
      <ImageWithFallback
        src={fallbackContent}
        alt={displayName || m.profile_avatar_alt()}
        fallbackType="avatar"
        size={sizeToProxy[size]}
        {loading}
        class="h-full w-full rounded-full object-cover"
      />
    {:else if showInitialFallback}
      <div
        class="flex h-full w-full items-center justify-center bg-primary text-sm font-semibold text-primary-content"
      >
        {m.profile_avatar_fallback()}
      </div>
    {/if}
  </div>
{/snippet}

{#if effectiveShowHoverCard && pubkey}
  <HoverCard fixed>
    {#snippet trigger()}
      <div class="avatar {className}">
        {@render avatarContent()}
      </div>
    {/snippet}
    {#snippet content()}
      <ProfileHoverCardContent {pubkey} profile={loadedProfile} />
    {/snippet}
  </HoverCard>
{:else if linkToProfile && pubkey}
  <a href={resolve(profileLink(pubkey))} class="avatar {className}">
    {@render avatarContent()}
  </a>
{:else}
  <div class="avatar {className}">
    {@render avatarContent()}
  </div>
{/if}
