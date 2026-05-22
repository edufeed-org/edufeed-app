<!--
  ProfileHoverCardContent Component
  Displays a compact profile preview for hover cards:
  banner + avatar overlap + name + nip05/npub + bio + badges + wave
-->

<script>
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { hexToNpub, generateAuthorColor } from '$lib/helpers/nostrUtils.js';
  import { CheckIcon } from '$lib/components/icons';
  import { useProfileBadges } from '$lib/stores/badge-awards.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import ImageWithFallback from './ImageWithFallback.svelte';
  import BadgeThumb from '../badges/BadgeThumb.svelte';
  import WaveButton from '../waves/WaveButton.svelte';

  /**
   * @typedef {Object} Props
   * @property {string} pubkey
   * @property {any} [profile]
   */

  /** @type {Props} */
  let { pubkey, profile = undefined } = $props();

  let displayName = $derived(
    getDisplayName(profile) || `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
  );
  let npub = $derived(hexToNpub(pubkey));
  let truncatedNpub = $derived(npub ? `${npub.slice(0, 16)}...` : '');
  let bio = $derived.by(() => {
    const about = profile?.about;
    if (!about) return '';
    return about.length > 100 ? about.slice(0, 100) + '…' : about;
  });

  let bannerColor = $derived(generateAuthorColor(pubkey));

  const { getBadges } = useProfileBadges(() => pubkey);
  let badges = $derived(getBadges());

  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());
  let showWave = $derived(activeUser && activeUser.pubkey !== pubkey);

  // Subscribe to kind 0 event for WaveButton
  /** @type {any} */
  let profileEvent = $state(undefined);
  $effect(() => {
    const sub = eventStore.replaceable(0, pubkey).subscribe((event) => {
      profileEvent = event;
    });
    return () => sub.unsubscribe();
  });
</script>

<a href={resolve(`/p/${pubkey}`)} class="block w-72 overflow-hidden rounded-lg">
  <!-- Banner -->
  {#if profile?.banner}
    <ImageWithFallback
      src={profile.banner}
      alt=""
      fallbackType="banner"
      size="banner"
      class="h-16 w-full object-cover"
    />
  {:else}
    <div
      class="h-16"
      style="background: linear-gradient(135deg, {bannerColor}, {bannerColor}88)"
    ></div>
  {/if}

  <!-- Avatar overlapping banner -->
  <div class="-mt-8 ml-3">
    <ProfileAvatar {pubkey} {profile} size="xl" showHoverCard={false} />
  </div>

  <!-- Info -->
  <div class="px-3 pt-1 pb-3">
    <div class="truncate font-bold text-base-content">{displayName}</div>
    {#if profile?.nip05}
      <div class="flex items-center gap-1 text-xs text-primary">
        <CheckIcon class_="w-3 h-3" />
        <span class="truncate">{profile.nip05}</span>
      </div>
    {:else if truncatedNpub}
      <div class="text-xs text-base-content/60">{truncatedNpub}</div>
    {/if}
    {#if bio}
      <div class="mt-1 text-sm text-base-content/70">{bio}</div>
    {/if}

    {#if badges.length > 0 || showWave}
      <div class="mt-2 flex items-center justify-between">
        {#if badges.length > 0}
          <div class="flex -space-x-1">
            {#each badges.slice(0, 5) as badge (badge.id)}
              <BadgeThumb
                thumb={badge.badgeThumb}
                image={badge.badgeImage}
                alt={badge.badgeName || 'Badge'}
                class="h-6 w-6 rounded-lg border-2 border-base-100"
              />
            {/each}
          </div>
        {:else}
          <div></div>
        {/if}
        {#if showWave && profileEvent}
          <WaveButton {profileEvent} pubkey={activeUser.pubkey} />
        {/if}
      </div>
    {/if}
  </div>
</a>
