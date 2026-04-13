<script>
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { HomeIcon, BellIcon, ScrollTextIcon, PeopleIcon } from '$lib/components/icons';
  import { getTotalUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { getDashboardActiveSection } from '$lib/helpers/dashboardNavigation.js';
  import * as m from '$lib/paraglide/messages';

  const sections = [
    { id: 'feed', href: resolve('/c/'), icon: HomeIcon, label: () => m.dashboard_nav_feed() },
    {
      id: 'inbox',
      href: resolve('/c/inbox'),
      icon: BellIcon,
      label: () => m.dashboard_nav_inbox()
    },
    {
      id: 'your-content',
      href: resolve('/c/') + '?view=your-content',
      icon: ScrollTextIcon,
      label: () => m.dashboard_nav_your_content()
    },
    {
      id: 'communities',
      href: resolve('/c/') + '?view=communities',
      icon: PeopleIcon,
      label: () => m.dashboard_nav_communities()
    }
  ];

  let activeSection = $derived(
    getDashboardActiveSection($page.url.pathname, $page.url.searchParams)
  );
</script>

<div
  class="pb-safe fixed right-0 bottom-0 left-0 z-50 border-t border-base-300 bg-base-100 lg:hidden"
>
  <div class="dock dock-lg mx-auto px-4 py-2">
    {#each sections as section (section.id)}
      {@const isActive = activeSection === section.id}
      {@const Icon = section.icon}
      <a href={section.href} class:dock-active={isActive}>
        <span class="relative">
          <Icon class_="size-[1.2em]" />
          {#if section.id === 'inbox' && getTotalUnreadCount() > 0}
            <span
              class="absolute -top-1 -right-1.5 badge h-3.5 min-w-3.5 badge-sm text-[9px] badge-primary"
            >
              {getTotalUnreadCount() > 99 ? '99+' : getTotalUnreadCount()}
            </span>
          {/if}
        </span>
        <span class="dock-label text-xs">{section.label()}</span>
      </a>
    {/each}
  </div>
</div>

<style>
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom);
  }
</style>
