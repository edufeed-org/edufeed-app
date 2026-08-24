<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { getContext, setContext } from 'svelte';
  import BottomTabBar from '$lib/components/community/layout/BottomTabBar.svelte';
  import LegacyContentTypesBanner from '$lib/components/community/LegacyContentTypesBanner.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { ProfileModel } from 'applesauce-core/models';
  import { profileLoader } from '$lib/loaders/profile.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { cacheRequest } from '$lib/stores/event-cache.svelte.js';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    getRestrictedTabIds,
    getAccessibleTabIds,
    getSectionNameForContentType,
    VALID_CONTENT_VIEWS
  } from '$lib/helpers/contentTypes.js';
  import { useCommunityAccess } from '$lib/stores/community-access.svelte.js';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { getCommunityWideFormRef } from '$lib/helpers/communityFormDefaults.js';
  import { useConcordCommunity, shouldShowChannelsTab } from '$lib/concord/community.svelte.js';
  import { parseGroupPointers } from '$lib/groups/community-pointer.js';
  import { parseMembershipPointer } from '$lib/groups/community-membership.js';
  import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
  import { useCommunityChannels } from '$lib/groups/community-channels.svelte.js';
  import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
  import { useEffectiveCommunity } from '$lib/groups/section-override.svelte.js';
  import { useRosterReconcile } from '$lib/groups/roster-reconcile.svelte.js';
  import { useCommunityFollowReconcile } from '$lib/groups/community-follow-reconcile.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { isCommunityOwner } from '$lib/helpers/community-signer.js';
  import { resolveZoneMembership } from '$lib/components/community/layout/community-nav.js';

  /** @type {{ data: any, children: import('svelte').Snippet }} */
  let { data, children } = $props();

  /** @typedef {import('$lib/types/layout.js').ContentNavData} ContentNavData */

  // State management for content type navigation
  // Single source of truth is the URL via the $effect below — do not assign
  // selectedContentType from anywhere else; the effect will overwrite it on
  // the next $page change.
  let selectedContentType = $state('home');
  let communikeyEvent = $state(/** @type {any} */ (null));
  let communityProfile = $state(/** @type {any} */ (null));
  let communikeyLoaded = $state(false);

  // Sync selectedContentType from child page data or ?view= param. Valid views
  // come from the shared VALID_CONTENT_VIEWS (contentTypes.js) — the SAME set
  // +page.js validates against, so the nav highlight can't drift from the
  // rendered content (a local copy here once omitted 'channels').
  $effect(() => {
    const childContentView = $page.data.contentView;
    const viewParam = $page.url.searchParams.get('view');
    const requested =
      childContentView && VALID_CONTENT_VIEWS.has(childContentView)
        ? childContentView
        : viewParam && VALID_CONTENT_VIEWS.has(viewParam)
          ? viewParam
          : 'home';

    // ?view= travels across community switches (buildCommunityPath keeps it,
    // and +page.js echoes it as contentView), so a globally-valid view can
    // still be one THIS community does not offer — arriving on an area-less
    // community with ?view=channels rendered the founding pane out of
    // nowhere (laoc, 2026-08-18). Fall back to home once the event is
    // loaded and says no.
    selectedContentType =
      requested === 'channels' && communikeyLoaded && !communityOffersChannels ? 'home' : requested;
  });

  // Load community's kind:10222 event for content type configuration
  $effect(() => {
    if (data.pubkey) {
      communikeyLoaded = false;
      const pointer = {
        kind: 10222,
        pubkey: data.pubkey
      };

      // Stale-while-revalidate: paint instantly from the IDB cache, but always
      // refresh from relays (cache: false) — the address loader stops at the
      // first source that yields the address, so a cached 10222 would otherwise
      // never be refreshed and edited content types would stay stale.
      cacheRequest([{ kinds: [pointer.kind], authors: [pointer.pubkey] }]).then((events) => {
        for (const event of events) eventStore.add(event);
      });

      const loaderSub = addressLoader({
        ...pointer,
        relays: getCommunikeyRelays(),
        cache: false
      }).subscribe({
        complete: () => {
          communikeyLoaded = true;
        }
      });

      const sub = eventStore.replaceable(pointer).subscribe((event) => {
        communikeyEvent = event || null;
        if (event) communikeyLoaded = true;
      });

      return () => {
        loaderSub.unsubscribe();
        sub.unsubscribe();
      };
    } else {
      communikeyEvent = null;
      communikeyLoaded = true;
    }
  });

  // Pre-warm community relays when community event is loaded
  $effect(() => {
    if (communikeyEvent) {
      import('$lib/services/relay-warming-service.svelte.js').then(({ warmCommunityRelays }) => {
        warmCommunityRelays(communikeyEvent);
      });
    }
  });

  // Load community profile for header display
  $effect(() => {
    communityProfile = null;

    if (data.pubkey) {
      const loaderSub = profileLoader({
        kind: 0,
        pubkey: data.pubkey,
        relays: getCommunikeyRelays()
      }).subscribe(() => {});

      const modelSub = eventStore.model(ProfileModel, data.pubkey).subscribe((profileContent) => {
        communityProfile = profileContent;
      });

      return () => {
        loaderSub.unsubscribe();
        modelSub.unsubscribe();
      };
    }
  });

  // Derive display name and avatar
  let displayName = $derived(
    communityProfile?.name || communityProfile?.display_name || 'Community'
  );
  let avatarUrl = $derived(getProfilePicture(communityProfile));

  // A moderated community's root-group admins can reshape its content
  // sections without holding the community key, via a kind-30223 override
  // (src/lib/groups/section-override.js). `effectiveCommunityEvent` is the
  // 10222 with that override's section block swapped in, so everything
  // downstream — tabs, gating, share pickers, the FAB — picks it up without
  // a signature change. `communikeyEvent` stays the raw event and is what
  // any signing/editing path must use.
  const getEffectiveCommunity = useEffectiveCommunity(() => communikeyEvent);
  let effectiveCommunityEvent = $derived(getEffectiveCommunity().event);
  let sectionSource = $derived(getEffectiveCommunity().source);
  let sectionAuthor = $derived(getEffectiveCommunity().author);

  let restrictedTabs = $derived(getRestrictedTabIds(effectiveCommunityEvent));

  const profileAccess = useCommunityAccess(
    () => effectiveCommunityEvent,
    () => getCommunikeyRelays()
  );
  let accessibleTabs = $derived(getAccessibleTabIds(effectiveCommunityEvent, profileAccess));

  // Provide shared data to child components via context
  let sectionName = $derived(
    getSectionNameForContentType(effectiveCommunityEvent, selectedContentType)
  );
  let allowedAuthors = $derived(
    sectionName && !profileAccess.isLoading ? profileAccess.getAllowedAuthors(sectionName) : null
  );

  let communityWideFormRef = $derived(
    !profileAccess.isLoading
      ? getCommunityWideFormRef(profileAccess, effectiveCommunityEvent)
      : null
  );

  const getIsMember = useCommunityMembership(() => data.pubkey);
  setContext('isCommunityMember', getIsMember);

  // Channel-row DATA for the sidebar's Kanäle zone (Task 7) — the SAME inputs
  // PrivateChannelsView uses (buildChannelRows + useConcordCommunity's
  // channels + parseGroupPointers + useChannelMetadata), but instantiated
  // ONCE here and threaded through ContentNavData so the sidebar doesn't
  // double-subscribe. PrivateChannelsView keeps its own instances this plan
  // (known duplication — a future pass should unify them).
  const getConcordForNav = useConcordCommunity(() => communikeyEvent);
  // Whether THIS community has any channels surface at all — same rule the
  // sidebar's KANÄLE zone uses (shouldShowChannelsTab), evaluated here for
  // the carried-?view=channels fallback above.
  const communityOffersChannels = $derived.by(() => {
    const concord = getConcordForNav();
    return shouldShowChannelsTab({
      enabled: concord.enabled,
      pointer: concord.pointer,
      isMember: concord.membership === 'member',
      hasGroupChannels: parseGroupPointers(communikeyEvent).length > 0,
      hasMembershipPointer: !!parseMembershipPointer(communikeyEvent)
    });
  });
  // Nav Kanäle-zone rows, DISCOVERED from the relay subtree (the SAME source
  // PrivateChannelsView uses; the two builders stay separate — known
  // duplication). No General row here, matching the prior nav behavior.
  const getCommunityChannelsForNav = useCommunityChannels(() =>
    parseMembershipPointer(communikeyEvent)
  );
  const channelRows = $derived(
    buildChannelRows({
      concordChannels: getConcordForNav().channels,
      subtreeChannels: getCommunityChannelsForNav().channels
    })
  );

  // Zone-membership signal for the sidebar's Kanäle zone (review of
  // 187b4c0b, critical 2) — deliberately NOT `getIsMember()` (kind-30000
  // follow set, a social bookmark unrelated to roster/Concord access; that
  // flag stays wired to its other consumer below, `isCommunityMember`
  // context). "Roster = truth": owner OR the moderated community's
  // root-group roster OR Concord area membership. concordIsMember reuses
  // `getConcordForNav` above — no second Concord subscription needed, it
  // already exposes `membership: 'none'|'member'` for exactly this. Roster
  // membership needs its own subscription (none existed in this file);
  // `useRootRoster` no-ops harmlessly for an open community (no membership
  // pointer → null pointer → isMember() always false).
  const getRootRosterForNav = useRootRoster(() => communikeyEvent);
  // Owner/admin-side roster reconcile (see the hook's header): whenever an
  // admin opens a moderated community, invite-code joiners missing from
  // members-tier channels are silently fanned out. Idles for everyone else.
  useRosterReconcile(() => communikeyEvent);
  // Member-side counterpart: if the root roster already holds me but my
  // kind-30000 `communities` set does not, follow. Without it, an accepted
  // join or an admin-granted role leaves the community with no rail entry and
  // its channels sitting in the rail as a bare relay tile instead.
  useCommunityFollowReconcile(() => communikeyEvent);
  const getActiveUserForNav = useActiveUser();
  const zoneMember = $derived.by(() => {
    const activeUser = getActiveUserForNav();
    const rosterIsMember = !!activeUser && getRootRosterForNav().isMember(activeUser.pubkey);
    return resolveZoneMembership({
      isOwner: isCommunityOwner(data.pubkey),
      rosterIsMember,
      concordIsMember: getConcordForNav().membership === 'member'
    });
  });
  // Root-39001-admin signal for the sidebar's create entry — same gate as
  // PrivateChannelsView's `canOpenCreateWizard` (8d03f873 widened create to
  // root admins; the desktop zone stayed owner-only until laoc 2026-08-21).
  // Reuses the roster subscription above, no extra network work.
  const zoneRootAdmin = $derived.by(() => {
    const activeUser = getActiveUserForNav();
    return !!activeUser && getRootRosterForNav().admins.some((a) => a.pubkey === activeUser.pubkey);
  });

  // The EFFECTIVE community event (10222 with any admin section override
  // applied), because every consumer of this context reads it for display.
  // Community-level metadata is preserved verbatim, so metadata readers
  // (MeetView's livekit URL) are unaffected. The settings forms receive it
  // too, and that is deliberate: an owner save then absorbs the admins'
  // section configuration into the 10222 instead of silently reverting it.
  setContext('communikeyEvent', () => effectiveCommunityEvent);
  setContext('sectionOverride', () => ({ source: sectionSource, author: sectionAuthor }));
  // The ONE availability-corrected content view (the $effect above). The
  // child page must render from THIS, not re-derive from $page.data — a
  // second source of truth is exactly how the sidebar hid the channels tab
  // while the pane still rendered it (laoc, 2026-08-18).
  setContext('resolvedContentView', () => selectedContentType);
  // Shared with MainContentArea so the closed-community shell can tell
  // insiders (owner ∪ roster ∪ Concord member) from visitors.
  setContext('zoneMember', () => zoneMember);
  setContext('communityWideFormRef', () => communityWideFormRef);
  setContext('communityProfile', () => communityProfile);
  setContext('communikeyLoaded', () => communikeyLoaded);
  setContext('profileAccess', profileAccess);
  setContext('allowedAuthors', () => allowedAuthors);

  // Expose ContentNavSidebar's data so the root layout can mount the sidebar
  // in the chrome row. Register the getter once; it closes over reactive
  // reads (selectedContentType, communityProfile, etc.) so root's
  // $derived(getContentNavData?.()) re-renders when any of them change.
  /** @type {((getter: (() => ContentNavData) | undefined) => void) | undefined} */
  const setContentNavData = getContext('setContentNavData');
  setContentNavData?.(() => ({
    selectedContentType,
    onContentTypeSelect: handleContentTypeSelect,
    communitySelected: true,
    communityProfile,
    communityPubkey: data.pubkey,
    restrictedTabs,
    accessibleTabs,
    communityEvent: effectiveCommunityEvent,
    channelRows,
    isMember: zoneMember,
    isRootAdmin: zoneRootAdmin
  }));
  $effect(() => () => setContentNavData?.(undefined));

  // Update parent layout's mobile header with community info
  const setMobileHeader =
    /** @type {((info: { title: string, avatarUrl?: string | null }) => void) | undefined} */ (
      getContext('setMobileHeader')
    );
  $effect(() => {
    if (setMobileHeader) {
      setMobileHeader({ title: displayName, avatarUrl });
    }
  });

  /**
   * Handle content type selection — navigates to community home with ?view=
   * param. An optional channelId seeds the Kanäle zone's deep link (`?channel=`)
   * so a Concord row click lands directly on that channel — PrivateChannelsView
   * picks the param up on mount (see its deep-link `$effect`).
   * @param {string} type
   * @param {string} [channelId]
   */
  function handleContentTypeSelect(type, channelId) {
    const base = resolve(`/c/${data.npub}`);
    if (type === 'home') {
      goto(base);
    } else if (channelId) {
      goto(`${base}?view=${type}&channel=${channelId}`);
    } else {
      goto(`${base}?view=${type}`);
    }
  }
</script>

<div class="px-4 pt-3 empty:hidden">
  <LegacyContentTypesBanner communityEvent={effectiveCommunityEvent} />
</div>

{@render children()}

<!-- Mobile: Bottom Tab Bar (fixed positioned) -->
<div class="lg:hidden">
  <BottomTabBar
    bind:selectedContentType
    onContentTypeSelect={handleContentTypeSelect}
    communityEvent={effectiveCommunityEvent}
    {restrictedTabs}
    {accessibleTabs}
  />
</div>
