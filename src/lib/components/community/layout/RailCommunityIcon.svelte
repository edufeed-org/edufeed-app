<!--
  A joined community's avatar in the rail.

  Split out of RailEntryIcon so the profile hook is only ever called for an
  entry that HAS a profile: useUserProfile falls back to the ACTIVE USER when
  it is given no pubkey, so calling it unconditionally would open a
  subscription to your own profile for every area and group in the rail.
-->
<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useUserProfile } from '$lib/stores/user-profile.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';

  /**
   * @type {{
   *   pubkey: string,
   *   isActive?: boolean,
   *   size?: string,
   *   onSelect?: (pubkey: string) => void
   * }}
   */
  let { pubkey, isActive = false, size = 'h-12 w-12', onSelect } = $props();

  const getProfile = useUserProfile(() => pubkey);
  const profile = $derived(getProfile());
</script>

<button
  title={getDisplayName(profile)}
  data-testid="rail-community-icon"
  onclick={() => onSelect?.(pubkey)}
  class="btn btn-circle {size} shrink-0 p-0 btn-ghost transition-transform duration-200 hover:scale-110 {isActive
    ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200'
    : ''}"
>
  <div class="avatar">
    <div class="{size} rounded-full">
      <ImageWithFallback
        src={getProfilePicture(profile) || `https://robohash.org/${pubkey}`}
        alt={getDisplayName(profile)}
        fallbackType="community"
        class="h-full w-full rounded-full object-cover"
      />
    </div>
  </div>
</button>
