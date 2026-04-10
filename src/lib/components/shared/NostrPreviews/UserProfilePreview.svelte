<!--
  UserProfilePreview Component
  Displays an inline mention for user profiles (npub/nprofile identifiers)
  Shows @username inline with text, similar to Twitter/X mentions
-->

<script>
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { hexToNpub } from '$lib/helpers/nostrUtils';
  import HoverCard from '../HoverCard.svelte';
  import ProfileHoverCardContent from '../ProfileHoverCardContent.svelte';

  let { identifier: _identifier, decoded } = $props();

  // Extract pubkey from decoded identifier
  let pubkey = $derived.by(() => {
    if (!decoded.success) return null;
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
    return null;
  });

  // Load profile using applesauce store - reactively subscribe when pubkey changes
  // Use getter function to avoid state_referenced_locally warning
  const getUserProfile = useUserProfile(() => pubkey);
  let profile = $derived(getUserProfile());

  // Derive display name with fallbacks
  let displayName = $derived(
    profile
      ? getDisplayName(profile) ||
          (pubkey ? `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}` : 'Unknown')
      : pubkey
        ? `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
        : 'Unknown'
  );

  // Determine link href
  let profileUrl = $derived(resolve(pubkey ? `/p/${hexToNpub(pubkey) || pubkey}` : '#'));
</script>

{#if !decoded.success || !pubkey}
  <!-- Error state: Invalid identifier -->
  <span class="font-medium text-error">⚠️ @invalid</span>
{:else if !profile}
  <!-- Loading state: Show placeholder while profile loads -->
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal: already resolved via resolve() -->
  <a href={profileUrl} class="font-medium text-info hover:underline">@...</a>
{:else}
  <!-- Loaded state: Inline mention with profile hover card -->
  <HoverCard enterDelay={300} leaveDelay={200} fixed>
    {#snippet trigger()}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal: already resolved via resolve() -->
      <a href={profileUrl} class="font-medium text-info no-underline hover:underline"
        >@{displayName}</a
      >
    {/snippet}
    {#snippet content()}
      <ProfileHoverCardContent {pubkey} {profile} />
    {/snippet}
  </HoverCard>
{/if}
