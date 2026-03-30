<!--
  ProfileAvatar Component
  Displays user avatar with fallback options
  Can load profile internally or accept it as a prop
-->

<script>
  import { ProfileModel } from 'applesauce-core/models';
  import { profileLoader } from '$lib/loaders/profile.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getProfilePicture, getDisplayName } from 'applesauce-core/helpers';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import ImageWithFallback from './ImageWithFallback.svelte';

  /**
   * @typedef {Object} Props
   * @property {string} [pubkey] - User pubkey (optional - if not provided, uses active user)
   * @property {any} [profile] - Profile object (optional - if not provided, loads internally)
   * @property {'xs' | 'sm' | 'md' | 'lg' | 'xl'} [size] - Avatar size
   * @property {'initial' | 'robohash'} [fallbackType] - Type of fallback to use
   * @property {boolean} [linkToProfile] - Wrap avatar in a link to the user's profile page
   * @property {string} [class] - Additional CSS classes
   */

  /** @type {Props} */
  let {
    pubkey = undefined,
    profile = undefined,
    size = 'md',
    fallbackType = 'initial',
    linkToProfile = false,
    class: className = ''
  } = $props();

  // Load profile reactively when pubkey changes
  let loadedProfile = $state(/** @type {any} */ (null));

  $effect(() => {
    // If profile is provided as prop, use it directly
    if (profile) {
      loadedProfile = profile;
      return;
    }

    // Reset profile when pubkey changes
    loadedProfile = null;

    // Load profile for the given pubkey
    if (pubkey) {
      // 1. Trigger loader to fetch from relays and populate eventStore
      const loaderSub = profileLoader({
        kind: 0,
        pubkey: pubkey,
        relays: runtimeConfig.fallbackRelays || []
      }).subscribe(() => {
        // Loader automatically populates eventStore
      });

      // 2. Subscribe to model for reactive parsed profile from eventStore
      const modelSub = eventStore.model(ProfileModel, pubkey).subscribe((profileContent) => {
        loadedProfile = profileContent;
      });

      // Return cleanup function to unsubscribe from both
      return () => {
        loaderSub.unsubscribe();
        modelSub.unsubscribe();
      };
    }
  });

  // Size mappings
  const sizeClasses = {
    xs: 'w-6',
    sm: 'w-8',
    md: 'w-10',
    lg: 'w-12',
    xl: 'w-16'
  };

  /** @type {Record<string, string>} */
  const sizeToProxy = {
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
  <div class="{sizeClasses[size]} rounded-full">
    {#if avatarUrl}
      <ImageWithFallback
        src={avatarUrl}
        alt={displayName || m.profile_avatar_alt()}
        fallbackType="avatar"
        size={sizeToProxy[size]}
        class="h-full w-full rounded-full object-cover"
      />
    {:else if showRobohashFallback}
      <ImageWithFallback
        src={fallbackContent}
        alt={displayName || m.profile_avatar_alt()}
        fallbackType="avatar"
        size={sizeToProxy[size]}
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

{#if linkToProfile && pubkey}
  <a href={resolve(`/p/${pubkey}`)} class="avatar {className}">
    {@render avatarContent()}
  </a>
{:else}
  <div class="avatar {className}">
    {@render avatarContent()}
  </div>
{/if}
