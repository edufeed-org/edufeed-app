<!--
  ProfileCard Component
  Displays full profile information with avatar, name, and npub
  Typically used in cards or lists. `showNip05` swaps the npub line for the
  verified NIP-05 identifier when the profile has one; `showAbout` adds a
  2-line clamped plain-text bio (both opt-in, used by the discover people tab).
-->

<script>
  import { resolve } from '$app/paths';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { hexToNpub, profileLink } from '$lib/helpers/nostrUtils.js';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import Nip05VerifiedBadge from './Nip05VerifiedBadge.svelte';
  import { UserIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {string} pubkey - User pubkey (required)
   * @property {any} [profile] - Profile object (optional - if not provided, loads internally)
   * @property {'sm' | 'md' | 'lg'} [size] - Card size
   * @property {boolean} [showNpub] - Show truncated npub
   * @property {boolean} [showNip05] - Show the NIP-05 identifier (verified badge) instead of the npub when present
   * @property {boolean} [showAbout] - Show a 2-line clamped plain-text bio when present
   * @property {boolean} [showIcon] - Show trailing icon
   * @property {boolean} [linkToProfile] - Make clickable link to profile page
   * @property {boolean} [showHoverCard] - Show hover card on inner avatar (default false, ProfileCard already shows profile info)
   * @property {() => void} [onClose] - Optional callback for modal close
   * @property {string} [class] - Additional CSS classes
   */

  /** @type {Props} */
  let {
    pubkey,
    profile = undefined,
    size = 'md',
    showNpub = true,
    showNip05 = false,
    showAbout = false,
    showIcon = true,
    linkToProfile = true,
    showHoverCard = false,
    onClose = undefined,
    class: className = ''
  } = $props();

  // Load profile if not provided as prop.
  // Pass a getter function so the hook can reactively track pubkey changes.
  const getProfile = useUserProfile(() => pubkey);
  let loadedProfile = $derived(profile || getProfile());

  // Get display information
  let displayName = $derived(
    getDisplayName(loadedProfile) || `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
  );
  let npub = $derived(hexToNpub(pubkey));
  let truncatedNpub = $derived(npub ? `${npub.slice(0, 16)}...` : '');
  let nip05 = $derived(
    showNip05 && typeof loadedProfile?.nip05 === 'string' ? loadedProfile.nip05.trim() : ''
  );
  let about = $derived(
    showAbout && typeof loadedProfile?.about === 'string' ? loadedProfile.about.trim() : ''
  );

  // Size mappings for avatar and padding
  const avatarSizes = /** @type {const} */ ({
    sm: /** @type {'sm'} */ ('sm'),
    md: /** @type {'md'} */ ('md'),
    lg: /** @type {'lg'} */ ('lg')
  });

  const paddingClasses = {
    sm: 'p-2',
    md: 'p-3',
    lg: 'p-4'
  };

  const gapClasses = {
    sm: 'gap-2',
    md: 'gap-3',
    lg: 'gap-4'
  };

  /**
   * Handle click
   * @param {MouseEvent} _e
   */
  function handleClick(_e) {
    if (onClose) {
      onClose();
    }
  }
</script>

{#snippet body()}
  <ProfileAvatar {pubkey} profile={loadedProfile} size={avatarSizes[size]} {showHoverCard} />
  <div class="min-w-0 flex-1">
    <div class="truncate font-medium text-base-content">
      {displayName}
    </div>
    {#if nip05}
      <div class="text-sm text-base-content/70">
        <Nip05VerifiedBadge {pubkey} {nip05} class_="max-w-full" />
      </div>
    {:else if showNpub}
      <div class="text-sm text-base-content/60">
        {truncatedNpub}
      </div>
    {/if}
    {#if about}
      <p
        class="mt-0.5 line-clamp-2 text-xs break-words text-base-content/70"
        data-testid="profile-card-about"
      >
        {about}
      </p>
    {/if}
  </div>
  {#if showIcon}
    <UserIcon class_="w-5 h-5 text-base-content/60" />
  {/if}
{/snippet}

{#if linkToProfile}
  <a
    href={resolve(profileLink(pubkey))}
    class="flex items-center rounded-lg bg-base-200 transition hover:bg-base-300 {paddingClasses[
      size
    ]} {gapClasses[size]} {className}"
    onclick={handleClick}
  >
    {@render body()}
  </a>
{:else}
  <div
    class="flex items-center rounded-lg bg-base-200 {paddingClasses[size]} {gapClasses[
      size
    ]} {className}"
  >
    {@render body()}
  </div>
{/if}
