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
  import { useProfileListAccess } from '$lib/stores/profile-list-access.svelte.js';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { getCommunityWideFormRef } from '$lib/helpers/communityFormDefaults.js';

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
    if (childContentView && VALID_CONTENT_VIEWS.has(childContentView)) {
      selectedContentType = childContentView;
      return;
    }

    const viewParam = $page.url.searchParams.get('view');
    if (viewParam && VALID_CONTENT_VIEWS.has(viewParam)) {
      selectedContentType = viewParam;
    } else {
      selectedContentType = 'home';
    }
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
  let restrictedTabs = $derived(getRestrictedTabIds(communikeyEvent));

  const profileAccess = useProfileListAccess(
    () => communikeyEvent,
    () => getCommunikeyRelays()
  );
  let accessibleTabs = $derived(getAccessibleTabIds(communikeyEvent, profileAccess));

  // Provide shared data to child components via context
  let sectionName = $derived(getSectionNameForContentType(communikeyEvent, selectedContentType));
  let allowedAuthors = $derived(
    sectionName && !profileAccess.isLoading ? profileAccess.getAllowedAuthors(sectionName) : null
  );

  let communityWideFormRef = $derived(
    !profileAccess.isLoading ? getCommunityWideFormRef(profileAccess, communikeyEvent) : null
  );

  const getIsMember = useCommunityMembership(() => data.pubkey);
  setContext('isCommunityMember', getIsMember);

  setContext('communikeyEvent', () => communikeyEvent);
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
    communityEvent: communikeyEvent
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
   * Handle content type selection — navigates to community home with ?view= param
   * @param {string} type
   */
  function handleContentTypeSelect(type) {
    const base = resolve(`/c/${data.npub}`);
    if (type === 'home') {
      goto(base);
    } else {
      goto(`${base}?view=${type}`);
    }
  }
</script>

<div class="px-4 pt-3 empty:hidden">
  <LegacyContentTypesBanner communityEvent={communikeyEvent} />
</div>

{@render children()}

<!-- Mobile: Bottom Tab Bar (fixed positioned) -->
<div class="lg:hidden">
  <BottomTabBar
    bind:selectedContentType
    onContentTypeSelect={handleContentTypeSelect}
    communityEvent={communikeyEvent}
    {restrictedTabs}
    {accessibleTabs}
  />
</div>
