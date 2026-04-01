<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { getContext, setContext } from 'svelte';
  import ContentNavSidebar from '$lib/components/community/layout/ContentNavSidebar.svelte';
  import BottomTabBar from '$lib/components/community/layout/BottomTabBar.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { ProfileModel } from 'applesauce-core/models';
  import { profileLoader } from '$lib/loaders/profile.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    getRestrictedTabIds,
    getAccessibleTabIds,
    CONTENT_TYPE_TO_SECTION
  } from '$lib/helpers/contentTypes.js';
  import { useProfileListAccess } from '$lib/stores/profile-list-access.svelte.js';

  /** @type {{ data: any, children: import('svelte').Snippet }} */
  let { data, children } = $props();

  // State management for content type navigation
  let selectedContentType = $state('home');
  let communikeyEvent = $state(/** @type {any} */ (null));
  let communityProfile = $state(/** @type {any} */ (null));
  let communikeyLoaded = $state(false);

  // Valid content types for ?view= query param
  const validContentTypes = new Set([
    'home',
    'chat',
    'calendar',
    'learning',
    'boards',
    'articles',
    'forum',
    'wikis',
    'social-bookmarks',
    'settings'
  ]);

  // Sync selectedContentType from child page data or ?view= param
  $effect(() => {
    const childContentView = $page.data.contentView;
    if (childContentView && validContentTypes.has(childContentView)) {
      selectedContentType = childContentView;
      return;
    }

    const viewParam = $page.url.searchParams.get('view');
    if (viewParam && validContentTypes.has(viewParam)) {
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

      const loaderSub = addressLoader({
        ...pointer,
        relays: getCommunikeyRelays()
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
  let sectionName = $derived(CONTENT_TYPE_TO_SECTION[selectedContentType]);
  let allowedAuthors = $derived(
    sectionName && !profileAccess.isLoading ? profileAccess.getAllowedAuthors(sectionName) : null
  );

  setContext('communikeyEvent', () => communikeyEvent);
  setContext('communityProfile', () => communityProfile);
  setContext('communikeyLoaded', () => communikeyLoaded);
  setContext('profileAccess', profileAccess);
  setContext('allowedAuthors', () => allowedAuthors);

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

<!-- Desktop: ContentNavSidebar (fixed positioned) + content flow -->
<ContentNavSidebar
  bind:selectedContentType
  onContentTypeSelect={handleContentTypeSelect}
  communitySelected={true}
  {communityProfile}
  communityPubkey={data.pubkey}
  {restrictedTabs}
  {accessibleTabs}
/>
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
