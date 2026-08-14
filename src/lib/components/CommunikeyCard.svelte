<script>
  let { pubkey, showJoinButton = false } = $props();

  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import * as m from '$lib/paraglide/messages';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useCommunityType } from '$lib/stores/community-type.svelte.js';
  import BookmarkIcon from '$lib/components/icons/social/BookmarkIcon.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils';
  import { joinCommunity, leaveCommunity } from '$lib/helpers/community';
  import { showToast } from '$lib/helpers/toast';
  import ImageWithFallback from './shared/ImageWithFallback.svelte';

  // Use the reusable user profile hook
  const getProfile = useUserProfile(() => pubkey);

  // Use the reusable community membership hook
  const getJoined = useCommunityMembership(() => pubkey);

  // Use the community type hook
  const getCommunityType = useCommunityType(() => pubkey);

  // Get active user for authentication
  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  let isJoining = $state(false);

  async function handleJoinClick(/** @type {MouseEvent} */ e) {
    e.preventDefault();
    e.stopPropagation();

    if (!activeUser) {
      showToast(m.communikey_card_toast_login_required(), 'error');
      return;
    }

    if (isJoining) return;

    isJoining = true;
    try {
      if (getJoined()) {
        const result = await leaveCommunity(pubkey);
        if (result.success) {
          showToast(m.communikey_card_toast_left(), 'success');
        } else {
          showToast(result.error || m.communikey_card_toast_left_failed(), 'error');
        }
      } else {
        const result = await joinCommunity(pubkey);
        if (result.success) {
          showToast(m.communikey_card_toast_joined(), 'success');
        } else {
          showToast(result.error || m.communikey_card_toast_joined_failed(), 'error');
        }
      }
    } catch (error) {
      console.error('Error toggling community membership:', error);
      showToast(m.communikey_card_toast_error(), 'error');
    } finally {
      isJoining = false;
    }
  }
</script>

<a
  href={resolve(pubkey ? `/c/${hexToNpub(pubkey) || pubkey}` : '#')}
  class="card flex transform cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border bg-base-100 p-6 shadow-md transition-all duration-300 hover:scale-105 hover:shadow-lg {getJoined()
    ? 'border-success/30'
    : 'border-base-200'} min-w-[240px] hover:border-primary/20"
>
  <div class="absolute top-3 right-3 z-10">
    {#if getJoined()}
      <div
        class="flex h-6 w-6 items-center justify-center rounded-full border border-success/20 bg-success shadow-sm"
      >
        <BookmarkIcon
          class_="w-3 h-3 text-success-content"
          title={m.communikey_card_joined_badge()}
        />
      </div>
    {:else}
      <!-- <div class="bg-base-200 text-base-content/70 text-xs font-medium px-2 py-1 rounded-md shadow-sm border border-base-300/50 hover:bg-base-300/50 transition-colors duration-200">
				Join
			</div> -->
    {/if}
  </div>

  <figure class="mb-3">
    <ImageWithFallback
      src={getProfilePicture(getProfile()) || `https://robohash.org/${pubkey}`}
      alt={m.communikey_card_profile_alt()}
      fallbackType="community"
      size="avatar_lg"
      class="h-24 w-24 rounded-full object-cover ring-2 ring-base-300 transition-colors duration-300 hover:ring-primary/50"
    />
  </figure>
  <div class="card-body w-full items-center p-0 text-center">
    <div class="flex items-center justify-center gap-2">
      <h2
        class="font-community card-title text-xl font-semibold text-base-content transition-colors duration-300 hover:text-primary"
      >
        {getProfile()?.name || m.communikey_card_unknown_user()}
      </h2>
      {#if getCommunityType() === 'moderated'}
        <span
          data-testid="community-type-badge"
          class="text-lg"
          title={`${m.community_type_moderated_title()} — ${m.community_type_moderated_body()}`}
        >
          🛡️
        </span>
      {:else if getCommunityType() === 'closed'}
        <span
          data-testid="community-type-badge"
          class="text-lg"
          title={`${m.community_type_closed_title()} — ${m.community_type_closed_body()}`}
        >
          🔒
        </span>
      {/if}
    </div>
    <p
      class="relative w-full text-sm leading-relaxed text-base-content/70"
      style="display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; mask-image: linear-gradient(to bottom, black 0%, black 70%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 0%, black 70%, transparent 100%);"
      title={getProfile()?.about || m.communikey_card_no_bio()}
    >
      {getProfile()?.about || m.communikey_card_no_bio()}
    </p>

    {#if showJoinButton && activeUser && getCommunityType() !== 'closed'}
      <button
        onclick={handleJoinClick}
        disabled={isJoining}
        class="btn mt-3 w-full btn-sm {getJoined() ? 'btn-outline' : 'btn-primary'}"
      >
        {#if isJoining}
          <span class="loading loading-xs loading-spinner"></span>
        {:else if getJoined()}
          {m.communikey_card_button_leave()}
        {:else}
          {m.communikey_card_button_join()}
        {/if}
      </button>
    {/if}
  </div>
</a>
