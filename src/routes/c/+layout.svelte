<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { getContext, setContext } from 'svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useIsDesktop } from '$lib/stores/viewport.svelte.js';
  import { hasStaticOwnBottomUI } from '$lib/helpers/bottomUiVisibility.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { buildCommunityPath } from '$lib/helpers/communityNavigation.js';
  import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';
  import MobileNavMenu from '$lib/components/shared/MobileNavMenu.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { ChevronLeftIcon, SettingsIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import TermiLauncherButton from '$lib/components/shared/TermiLauncherButton.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ children: import('svelte').Snippet }} */
  let { children } = $props();

  const activeUser = useActiveUser();

  // Pick ONE layout branch for the viewport (Tailwind's lg breakpoint).
  // Rendering the page in a desktop AND a mobile branch and hiding one with
  // CSS mounted every /c page twice — hidden twins still ran their effects
  // and click handlers, so one Follow click toasted and published twice.
  // /c is ssr = false, so the viewport is known on first render.
  const isDesktop = useIsDesktop();
  const hasWorkspaceShell = getContext('workspaceShell');

  // Bounded height chain (h-full + min-h-0 flex-1 down to the child layout)
  // ONLY for pages that own their bottom edge — the chat composer, the
  // channels view, the DM thread — which size themselves against it. Every
  // other page flows: a long page used to overflow the bounded box, and
  // <main>'s dock padding sat at the box end instead of after the content,
  // so the last 80px hid under the dock (issue "mobile: bottom nav bar hides
  // content"). /c/messages stays bounded as a whole: the open thread is a
  // page-supplied signal the root layout has, this layout has not.
  const resolvedMessages = resolve('/c/messages');
  const boundedChain = $derived(
    hasStaticOwnBottomUI({
      pathname: $page.url.pathname,
      viewParam: $page.url.searchParams.get('view')
    }) || $page.url.pathname.startsWith(resolvedMessages)
  );

  // Mobile header info — child layouts can update this via context
  let mobileHeaderTitle = $state(runtimeConfig.appName);
  let mobileHeaderAvatarUrl = $state(/** @type {string | null} */ (null));
  // Community mode: owners/admins get a gear that links to ?view=settings.
  let mobileHeaderShowSettings = $state(false);
  let mobileHeaderSettingsHref = $state('');

  // Detect mode from route params
  let currentCommunityPubkey = $derived($page.params.pubkey ? $page.data?.pubkey : null);
  let isDashboardActive = $derived(!currentCommunityPubkey);

  /**
   * Handle community selection from sidebar
   * @param {string} pubkey
   */
  function handleCommunitySelect(pubkey) {
    const npub = hexToNpub(pubkey);
    if (npub) {
      goto(resolve(/** @type {any} */ (buildCommunityPath(npub, $page.url.searchParams))));
    }
  }

  function handleHomeSelect() {
    goto(resolve('/c/'));
  }

  // Provide context for child layouts to update mobile header
  setContext(
    'setMobileHeader',
    (
      /** @type {{ title: string, avatarUrl?: string | null, showSettings?: boolean, settingsHref?: string }} */ info
    ) => {
      mobileHeaderTitle = info.title;
      mobileHeaderAvatarUrl = info.avatarUrl ?? null;
      mobileHeaderShowSettings = info.showSettings ?? false;
      mobileHeaderSettingsHref = info.settingsHref ?? '';
    }
  );

  function closeDropdown() {
    const dropdownTrigger = /** @type {HTMLElement} */ (document.activeElement);
    if (dropdownTrigger && dropdownTrigger.closest('.dropdown')) {
      dropdownTrigger.blur();
    }
  }
</script>

{#if isDesktop()}
  <!-- Desktop Layout -->
  <div class="contents">
    {#if activeUser() && !hasWorkspaceShell}
      <CommunitySidebar
        currentCommunityId={currentCommunityPubkey}
        currentPath={$page.url.pathname}
        {isDashboardActive}
        onCommunitySelect={handleCommunitySelect}
        onHomeSelect={handleHomeSelect}
      />
    {/if}
    {@render children()}
  </div>
{:else if activeUser()}
  <!-- Mobile Layout -->
  <!-- Every box from the root <main> down to the child layout keeps a
    definite height (flex-1 + min-h-0, h-full): bounded views — the channel
    chat and the call stage inside it — resolve h-full against this chain.
    A plain block here let them grow with their content, so the page scrolled
    instead of the timeline (laoc, 2026-10-01). Long views still overflow
    into <main>, which stays the scroll surface. -->
  <div data-testid="mobile-shell" class="flex flex-1 flex-col" class:min-h-0={boundedChain}>
    <div
      data-testid="mobile-column"
      class="flex flex-col"
      class:h-full={boundedChain}
      class:min-h-0={boundedChain}
    >
      <!-- Unified Mobile Header -->
      <div
        data-testid="mobile-community-header"
        class="sticky top-0 z-30 flex items-center justify-between bg-base-200 p-4"
      >
        {#if isDashboardActive}
          <!-- Dashboard: plain logo; the Communities dock tab is the switcher -->
          <div class="avatar px-1">
            <div class="w-8 rounded-full">
              <ImageWithFallback
                src={runtimeConfig.appLogo}
                alt={m.community_layout_title()}
                fallbackType="generic"
                class="h-full w-full object-cover"
              />
            </div>
          </div>
          <h1 class="min-w-0 flex-1 truncate text-center text-base font-semibold">
            {runtimeConfig.appName}
          </h1>
        {:else}
          <!-- Community: back to the list, name as plain text -->
          <a
            data-testid="header-back"
            href={resolve('/c/') + '?view=communities'}
            class="btn btn-circle btn-ghost"
            aria-label={m.community_header_back_aria()}
          >
            <ChevronLeftIcon class_="w-6 h-6" />
          </a>
          <div data-testid="header-title" class="flex min-w-0 flex-1 items-center gap-2 px-2">
            {#if mobileHeaderAvatarUrl}
              <div class="avatar">
                <div class="w-7 rounded-full ring-1 ring-base-300">
                  <ImageWithFallback
                    src={mobileHeaderAvatarUrl}
                    alt=""
                    fallbackType="community"
                    size="avatar_sm"
                    class="h-full w-full rounded-full object-cover"
                  />
                </div>
              </div>
            {/if}
            <span class="truncate text-base font-semibold">{mobileHeaderTitle}</span>
          </div>
        {/if}

        <!-- Right: Termi launcher + user avatar → global nav dropdown -->
        {#if activeUser()}
          <div class="flex items-center gap-1">
            {#if !isDashboardActive && mobileHeaderShowSettings}
              <a
                data-testid="header-settings"
                href={mobileHeaderSettingsHref}
                class="btn btn-circle btn-ghost"
                aria-label={m.community_header_settings_aria()}
              >
                <SettingsIcon class_="w-6 h-6" />
              </a>
            {/if}
            <TermiLauncherButton />
            <div class="dropdown dropdown-end">
              <div tabindex="0" role="button" class="btn btn-circle btn-ghost">
                <ProfileAvatar pubkey={activeUser().pubkey} size="sm" fallbackType="robohash" />
              </div>
              <ul
                class="dropdown-content menu z-[60] mt-3 w-56 rounded-box bg-base-100 p-2 shadow-lg"
              >
                <MobileNavMenu onClose={closeDropdown} />
              </ul>
            </div>
          </div>
        {:else}
          <div class="w-10"></div>
        {/if}
      </div>

      <!-- Main Content (child layout renders here) -->
      <!-- Flowing pages get a BLOCK slot: as a flex item with auto margins a
             page's `mx-auto max-w-3xl` box is sized to its content, and one
             no-wrap line (a truncated DM preview) pushed it to 768px in a
             640px viewport — the whole page scrolled sideways. -->
      <div
        data-testid="mobile-slot"
        class="flex-1"
        class:flex={boundedChain}
        class:flex-col={boundedChain}
        class:min-h-0={boundedChain}
      >
        {@render children()}
      </div>
    </div>
  </div>
{:else}
  <div class="flex min-h-0 flex-1 flex-col">
    {@render children()}
  </div>
{/if}
