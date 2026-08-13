<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { joinCommunity } from '$lib/helpers/community';
  import { deriveCommunityType } from '$lib/groups/community-membership.js';
  import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
  import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { joinCommunityGroup } from '$lib/groups/join-community-group.js';
  import { isMembershipRefusal } from '$lib/groups/groups.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
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

  // Moderated (NIP-29 root group) join lane — independent of the kind-30000
  // follow-set join above, per the plan's "following stays independent".
  const getActiveUser = useActiveUser();
  const getRootRoster = useRootRoster(() => communikeyEvent);
  const getRootMetadata = useChannelMetadata(() => {
    const pointer = getRootRoster().pointer;
    return pointer ? [pointer] : [];
  });

  let isJoining = $state(false);
  let requestSent = $state(false);
  let isSendingJoin = $state(false);
  let showInviteInput = $state(false);
  let inviteCode = $state('');
  let isSendingInvite = $state(false);

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

  /** Report a joinCommunityGroup rejection with the friendliest toast we can. */
  function reportJoinError(/** @type {unknown} */ error) {
    if (isMembershipRefusal(error)) {
      showToast(m.community_join_refused(), 'error');
    } else {
      const reason = /** @type {any} */ (error)?.message ?? String(error);
      showToast(m.community_join_failed({ reason }), 'error');
    }
  }

  /** Bare 9021 join request against the community's root group. */
  async function handleJoinGroup() {
    if (isSendingJoin || !activeUser || !rootPointer) return;
    isSendingJoin = true;
    try {
      await joinCommunityGroup({ pointer: rootPointer, user: activeUser });
      requestSent = true;
      getRootRoster().refresh();
    } catch (error) {
      reportJoinError(error);
    } finally {
      isSendingJoin = false;
    }
  }

  /** 9021 join request carrying an invite code. */
  async function handleJoinWithCode() {
    const code = inviteCode.trim();
    if (isSendingInvite || !activeUser || !rootPointer || !code) return;
    isSendingInvite = true;
    try {
      await joinCommunityGroup({ pointer: rootPointer, code, user: activeUser });
      requestSent = true;
      showInviteInput = false;
      inviteCode = '';
      getRootRoster().refresh();
    } catch (error) {
      reportJoinError(error);
    } finally {
      isSendingInvite = false;
    }
  }

  let displayName = $derived(getDisplayName(profileEvent) || 'Community');
  let avatarUrl = $derived(getProfilePicture(profileEvent));
  let bannerUrl = $derived(profileEvent?.banner || null);
  let description = $derived(communikeyEvent?.content || '');
  // Community type is derived from the event's pointer tags (never
  // declared) — closed communities have no kind-30000 follow-set join, so
  // the button block is skipped for them entirely.
  let communityType = $derived(deriveCommunityType(communikeyEvent));
  let isClosed = $derived(communityType === 'closed');
  let isModerated = $derived(communityType === 'moderated');

  let activeUser = $derived(getActiveUser());
  let rootPointer = $derived(getRootRoster().pointer);
  let isRosterLoading = $derived(getRootRoster().isLoading);
  let isRosterMember = $derived(!!activeUser && getRootRoster().isMember(activeUser.pubkey));
  // The root group's own kind:39000 "closed" marker (group-management.js's
  // metadataTags) — distinct from the read-access `private` tag
  // channel-access.js reads. "Closed" here means bare 9021s are ignored;
  // an invite code is still honoured, so that affordance is never gated on it.
  let rootMetadataKey = $derived(rootPointer ? channelKey(rootPointer) : null);
  let rootMetadataEvent = $derived(
    rootMetadataKey ? getRootMetadata().byKey[rootMetadataKey] : null
  );
  // Same lock-direction default as channel-access.js: missing/unloaded
  // metadata counts as CLOSED, never as open — a 39000 that hasn't arrived
  // yet (or an unreachable relay) must not offer a bare join button whose
  // 9021 the relay would silently ignore. The invite-code affordance is
  // unaffected — it is always legitimate once the roster itself has loaded.
  let isRootClosed = $derived(
    !rootMetadataEvent ||
      !!rootMetadataEvent.tags?.some((/** @type {string[]} */ t) => t[0] === 'closed')
  );
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
        {#if isClosed}
          <div class="badge gap-1 badge-sm badge-neutral">
            {m.community_type_closed_title()}
          </div>
        {/if}
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
        {#if isModerated && activeUser && isRosterMember}
          <div class="badge gap-1 badge-sm badge-success">
            {m.community_join_member()}
          </div>
        {/if}
      </div>
    </div>

    <!-- Closed communities: no kind-30000 follow join, just the hint -->
    {#if isClosed}
      <div class:mt-7={bannerUrl} class:mt-2={!bannerUrl}>
        <span class="text-sm text-base-content/60">{m.community_hero_closed_hint()}</span>
      </div>
    {:else if !getJoined()}
      <!-- Join Button (non-members) -->
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

    <!-- Moderated (NIP-29) root-group join lane — independent of the
         kind-30000 follow above. Only for non-roster-members without a
         structured application form (that path keeps its own button above).
         Held back entirely while the roster is still loading: isMember()
         defaults false until the first roster event arrives, so rendering
         join affordances before then would flash them at an actual member. -->
    {#if isModerated && activeUser && !isRosterMember && !getCommunityWideFormRef?.()}
      <div class:mt-7={bannerUrl} class:mt-2={!bannerUrl}>
        {#if isRosterLoading}
          <span class="loading loading-xs loading-spinner text-base-content/40"></span>
        {:else}
          <div class="flex flex-col items-end gap-1">
            {#if requestSent}
              <!-- Pending message stays alongside the invite-code affordance,
                   not instead of it: redeeming a code is always legitimate
                   even after a bare 9021 is already outstanding. -->
              <span class="text-sm text-base-content/60">{m.community_join_pending()}</span>
            {:else if !isRootClosed}
              <button
                onclick={handleJoinGroup}
                disabled={isSendingJoin}
                class="btn btn-sm btn-primary"
              >
                {#if isSendingJoin}
                  <span class="loading loading-xs loading-spinner"></span>
                {:else}
                  {m.community_join_group()}
                {/if}
              </button>
            {/if}
            {#if !showInviteInput}
              <button onclick={() => (showInviteInput = true)} class="btn btn-ghost btn-xs">
                {m.community_join_invite_toggle()}
              </button>
            {:else}
              <div class="flex items-center gap-1">
                <input
                  type="text"
                  bind:value={inviteCode}
                  placeholder={m.community_join_invite_placeholder()}
                  aria-label={m.community_join_invite_placeholder()}
                  class="input-bordered input input-xs w-20"
                />
                <button
                  onclick={handleJoinWithCode}
                  disabled={isSendingInvite || !inviteCode.trim()}
                  class="btn btn-xs btn-primary"
                >
                  {m.community_join_invite_submit()}
                </button>
              </div>
            {/if}
          </div>
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
