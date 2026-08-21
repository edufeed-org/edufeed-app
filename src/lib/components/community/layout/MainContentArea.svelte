<script>
  import { getContext } from 'svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import Chat from '../views/Chat.svelte';
  import CalendarView from '$lib/components/calendar/CalendarView.svelte';
  import LearningView from '../views/LearningView.svelte';
  import BoardsView from '../views/BoardsView.svelte';
  import ArticlesView from '../views/ArticlesView.svelte';
  import ForumView from '../views/ForumView.svelte';
  import PollsView from '../views/PollsView.svelte';
  import WikisView from '../views/WikisView.svelte';
  import SocialBookmarksView from '../views/SocialBookmarksView.svelte';
  import MeetView from '$lib/components/meet/MeetView.svelte';
  import MembersView from '../views/MembersView.svelte';
  import HomeView from '../views/HomeView.svelte';
  import ClosedCommunityShell from '../views/ClosedCommunityShell.svelte';
  import ClosedWindowBanner from '../views/ClosedWindowBanner.svelte';
  import { windowSectionKeys } from '$lib/concord/publisher-window.js';
  import PrivateChannelsView from '../channels/PrivateChannelsView.svelte';
  import SettingsView from '../views/SettingsView.svelte';
  import AccessGateBanner from '$lib/components/forms/AccessGateBanner.svelte';
  import PublisherOfferBanner from '../PublisherOfferBanner.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getSectionNameForContentType } from '$lib/helpers/contentTypes.js';
  import { rosterGateForSection } from '$lib/helpers/share-permission.js';
  import { roleLabel } from '$lib/groups/role-labels.js';
  import { deriveCommunityType } from '$lib/groups/community-membership.js';
  import * as m from '$lib/paraglide/messages';

  let { selectedCommunityId, selectedContentType, onKindNavigation } = $props();

  // Consume shared data from layout context (eliminates duplicate loading)
  const getCommunikeyEvent = getContext('communikeyEvent');
  const getCommunityProfile = getContext('communityProfile');
  const getCommunikeyLoaded = getContext('communikeyLoaded');
  const profileAccess = getContext('profileAccess');
  const getIsMember = getContext('isCommunityMember');
  // Insider signal (owner ∪ roster ∪ Concord member) for the closed shell —
  // optional so standalone renders/tests without the layout still work.
  const getZoneMember = getContext('zoneMember');

  let communikeyEvent = $derived(getCommunikeyEvent());
  let communityProfile = $derived(getCommunityProfile());
  let isLoading = $derived(!getCommunikeyLoaded());
  // Closed communities (concord pointer, no membership pointer) have no
  // readable content for a non-member — their "home" is the invite-only
  // shell, not the activity feed. Settings stays reachable (owner-only in
  // practice, enforced by SettingsView itself).
  let isClosedCommunity = $derived(deriveCommunityType(communikeyEvent) === 'closed');
  // Closed + window sections: the window's content is genuinely public
  // (gates control publishing, never reading), so outsiders get the normal
  // home over that content plus a banner — the lock-wall shell would deny
  // the very content the window exists to show. The windowless shell shape
  // keeps the wall: there is nothing public to render behind it.
  let hasWindowSections = $derived(
    windowSectionKeys(communikeyEvent?.tags ?? [], communikeyEvent?.pubkey ?? '').length > 0
  );
</script>

<!-- Main Content Area -->
<div class="min-h-0 flex-1 transition-all duration-300">
  {#if !selectedCommunityId}
    <!-- Empty state: No community selected -->
    <div class="flex h-full flex-col items-center justify-center p-8 text-center">
      <div class="max-w-md">
        <h2 class="mb-4 text-2xl font-bold text-base-content">
          {m.community_layout_main_content_welcome_title({ appName: runtimeConfig.appName })}
        </h2>
        <p class="mb-6 text-base-content/60">
          {m.community_layout_main_content_welcome_description()}
        </p>
      </div>
    </div>
  {:else if isLoading}
    <!-- Loading state -->
    <div class="flex h-full items-center justify-center">
      <div class="loading loading-lg loading-spinner text-primary"></div>
    </div>
  {:else}
    <!-- Key block ensures views remount when community changes -->
    {#key selectedCommunityId}
      {@const sectionName = getSectionNameForContentType(communikeyEvent, selectedContentType)}
      {@const formRef = sectionName ? profileAccess.getFormRef(sectionName) : null}
      {@const userPubkey = manager.active?.pubkey}
      {@const canPublish = sectionName ? profileAccess.canPublish(sectionName) : true}
      {@const rosterGate = rosterGateForSection(communikeyEvent, sectionName)}

      {#if userPubkey && getIsMember() && !canPublish && formRef && !profileAccess.isLoading}
        <AccessGateBanner {formRef} {sectionName} {userPubkey} />
      {:else if userPubkey && !canPublish && !formRef && !profileAccess.isLoading && rosterGate}
        <!-- Moderated communities gate on the roster, and there is no
             application flow to point at (the form-based join was removed as
             YAGNI) — so this states the rule and stops, rather than offering
             an action that does not exist. Without it a member simply finds
             the composer missing with no explanation. -->
        <div class="px-4 pt-3">
          <div class="alert alert-info" data-testid="roster-gate-notice">
            <span>
              {rosterGate.access.tier === 'members'
                ? m.community_roster_gate_members()
                : m.community_roster_gate_role({ role: roleLabel(rosterGate.access.role ?? '') })}
            </span>
          </div>
        </div>
      {/if}

      <!-- Publisher-window consent step (self-gates on an open offer) -->
      <PublisherOfferBanner {communikeyEvent} />

      {#if selectedContentType === 'home' && isClosedCommunity && !hasWindowSections}
        <ClosedCommunityShell
          {communikeyEvent}
          {communityProfile}
          isInsider={!!getZoneMember?.()}
        />
      {:else if selectedContentType === 'home'}
        {#if isClosedCommunity && !getZoneMember?.()}
          <ClosedWindowBanner {communikeyEvent} />
        {/if}
        <HomeView
          {communikeyEvent}
          profileEvent={communityProfile}
          communityId={selectedCommunityId}
          {onKindNavigation}
        />
      {:else if selectedContentType === 'chat'}
        <Chat
          {communikeyEvent}
          {communityProfile}
          communityPubkey={selectedCommunityId}
          {canPublish}
        />
      {:else if selectedContentType === 'channels'}
        <PrivateChannelsView
          {communikeyEvent}
          {communityProfile}
          communityPubkey={selectedCommunityId}
        />
      {:else if selectedContentType === 'calendar'}
        <CalendarView
          communityPubkey={selectedCommunityId}
          communityMode={true}
          {communityProfile}
        />
      {:else if selectedContentType === 'learning'}
        <LearningView communityPubkey={selectedCommunityId} {communityProfile} {communikeyEvent} />
      {:else if selectedContentType === 'boards'}
        <BoardsView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'articles'}
        <ArticlesView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'forum'}
        <ForumView communityPubkey={selectedCommunityId} {communityProfile} {canPublish} />
      {:else if selectedContentType === 'polls'}
        <PollsView communityPubkey={selectedCommunityId} {communityProfile} {canPublish} />
      {:else if selectedContentType === 'wikis'}
        <WikisView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'social-bookmarks'}
        <SocialBookmarksView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'meet'}
        <MeetView communityPubkey={selectedCommunityId} {communityProfile} />
      {:else if selectedContentType === 'members'}
        <MembersView {communikeyEvent} />
      {:else if selectedContentType === 'settings'}
        <SettingsView
          communityId={selectedCommunityId}
          {communikeyEvent}
          profileEvent={communityProfile}
        />
      {/if}
    {/key}
  {/if}
</div>
