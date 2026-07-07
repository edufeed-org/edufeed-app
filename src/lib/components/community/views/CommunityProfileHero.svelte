<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { joinCommunity } from '$lib/helpers/community';
  import { showToast } from '$lib/helpers/toast';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { nip19 } from 'nostr-tools';
  import { getContext } from 'svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import ImageWithFallback from '../../shared/ImageWithFallback.svelte';
  import { ChevronRightIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  let {
    communityId,
    communikeyEvent,
    profileEvent,
    onNavigateToAbout,
    memberPubkeys = [],
    onMembersClick
  } = $props();

  const MAX_FACEPILE = 3;
  let facepileMembers = $derived(memberPubkeys.slice(0, MAX_FACEPILE));

  const getCommunityWideFormRef = /** @type {() => string | null} */ (
    getContext('communityWideFormRef')
  );

  const getJoined = useCommunityMembership(() => communityId);

  let isJoining = $state(false);

  /** Navigate to the form respond page for join request */
  function handleRequestJoin() {
    const formRef = getCommunityWideFormRef?.();
    if (!formRef) return;
    const parts = formRef.split(':');
    if (parts.length < 3) return;
    const [kindStr, pubkey, ...identifierParts] = parts;
    const kind = parseInt(kindStr, 10);
    const identifier = identifierParts.join(':');
    try {
      const naddr = nip19.naddrEncode({ kind, pubkey, identifier, relays: [] });
      const returnTo = encodeURIComponent($page.url.pathname);
      goto(`/forms/${naddr}/respond?returnTo=${returnTo}&communityId=${communityId}`);
    } catch {
      // fallback to instant join
      handleJoin();
    }
  }

  async function handleJoin() {
    if (isJoining) return;
    isJoining = true;
    try {
      const result = await joinCommunity(communityId);
      if (result.success) {
        showToast(m.communikey_header_join_button() + ' ✓', 'success');
      } else {
        showToast(result.error || 'Failed to follow', 'error');
      }
    } catch {
      showToast('An error occurred', 'error');
    } finally {
      isJoining = false;
    }
  }

  let displayName = $derived(getDisplayName(profileEvent) || 'Community');
  let avatarUrl = $derived(getProfilePicture(profileEvent));
  let bannerUrl = $derived(profileEvent?.banner || null);
  let description = $derived(communikeyEvent?.content || '');
</script>

<!-- Banner — only when the community actually set one (design: the
     no-banner variant leaves it out and the header sits in flow) -->
{#if bannerUrl}
  <div class="relative overflow-hidden rounded-t-xl">
    <div class="h-24 md:h-32">
      <img
        src={bannerUrl}
        alt=""
        class="h-full w-full object-cover"
        onerror={(e) => {
          const img = /** @type {HTMLImageElement} */ (/** @type {unknown} */ (e.target));
          if (img) img.style.display = 'none';
        }}
      />
    </div>
  </div>
{/if}

<!-- Identity Section -->
<div class="px-4 pb-4" class:pt-5={!bannerUrl}>
  <div class="flex items-start gap-3" class:-mt-6={bannerUrl}>
    <!-- Avatar -->
    <div class="avatar">
      <div class="w-14 rounded-full ring-2 ring-base-100" class:ring-4={bannerUrl}>
        {#if avatarUrl}
          <ImageWithFallback
            src={avatarUrl}
            alt={displayName}
            size="avatar_lg"
            class="h-full w-full rounded-full object-cover"
          />
        {:else}
          <div
            class="flex h-full w-full items-center justify-center bg-primary/20 text-lg font-bold text-primary"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        {/if}
      </div>
    </div>

    <!-- Name + Meta -->
    <div class="min-w-0 flex-1" class:mt-7={bannerUrl} class:mt-2={!bannerUrl}>
      <div class="flex items-center gap-2">
        <h2 class="truncate text-2xl font-extrabold tracking-tight text-base-content">
          {displayName}
        </h2>
        {#if getJoined()}
          <div class="badge gap-1 badge-sm badge-success">
            <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clip-rule="evenodd"
              />
            </svg>
            {m.communikey_header_joined_badge()}
          </div>
        {/if}
      </div>
    </div>

    <!-- Join Button (non-members) -->
    {#if !getJoined()}
      <div class:mt-7={bannerUrl} class:mt-2={!bannerUrl}>
        {#if getCommunityWideFormRef?.()}
          <button onclick={handleRequestJoin} class="btn btn-sm btn-primary">
            {m.community_request_join()}
          </button>
        {:else}
          <button onclick={handleJoin} disabled={isJoining} class="btn btn-sm btn-primary">
            {#if isJoining}
              <span class="loading loading-xs loading-spinner"></span>
            {:else}
              {m.communikey_header_join_button()}
            {/if}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Member Facepile -->
  {#if memberPubkeys.length > 0}
    <button
      class="mt-1 flex items-center gap-1.5 text-sm hover:text-primary"
      onclick={onMembersClick}
    >
      <div class="avatar-group -space-x-2">
        {#each facepileMembers as pubkey (pubkey)}
          <ProfileAvatar {pubkey} size="xs" class="ring-2 ring-base-100" />
        {/each}
      </div>
      <span class="text-base-content/60"
        >{m.community_members_count({ count: memberPubkeys.length })}</span
      >
      <ChevronRightIcon class_="h-3.5 w-3.5 text-base-content/40" />
    </button>
  {/if}

  <!-- Description (truncated) -->
  {#if description}
    <p class="mt-2 line-clamp-2 text-sm text-base-content/70 lg:line-clamp-1">
      {description}
    </p>
    {#if description.length > 100 && onNavigateToAbout}
      <button onclick={onNavigateToAbout} class="mt-1 text-sm text-primary hover:underline">
        {m.community_profile_hero_more()}
      </button>
    {/if}
  {/if}
</div>
