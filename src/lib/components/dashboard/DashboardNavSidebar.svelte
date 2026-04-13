<script>
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import {
    HomeIcon,
    BellIcon,
    MessageSquareIcon,
    ScrollTextIcon,
    PeopleIcon
  } from '$lib/components/icons';
  import { getTotalUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { getUnreadDmCount } from '$lib/services/dm-service.svelte.js';
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
      id: 'messages',
      href: resolve('/c/messages'),
      icon: MessageSquareIcon,
      label: () => m.dashboard_nav_messages()
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
  class="fixed top-16 left-(--sidebar-icon-w) hidden h-[calc(100vh-8rem)] w-(--sidebar-nav-w) flex-col overflow-y-auto border-r border-base-300 bg-base-100 lg:flex"
>
  <nav class="menu space-y-1 p-4">
    {#each sections as section (section.id)}
      {@const isActive = activeSection === section.id}
      {@const Icon = section.icon}
      <a
        href={section.href}
        class="flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 {isActive
          ? 'bg-primary text-primary-content'
          : 'hover:bg-base-200'}"
      >
        <span class="relative">
          <Icon class_="w-5 h-5" />
          {#if section.id === 'inbox' && getTotalUnreadCount() > 0}
            <span
              class="absolute -top-1.5 -right-2 badge h-4 min-w-4 badge-sm text-[10px] badge-primary"
            >
              {getTotalUnreadCount() > 99 ? '99+' : getTotalUnreadCount()}
            </span>
          {:else if section.id === 'messages' && getUnreadDmCount() > 0}
            <span
              class="absolute -top-1.5 -right-2 badge h-4 min-w-4 badge-sm text-[10px] badge-primary"
            >
              {getUnreadDmCount() > 99 ? '99+' : getUnreadDmCount()}
            </span>
          {/if}
        </span>
        <span class="text-sm font-medium">{section.label()}</span>
      </a>
    {/each}
  </nav>
</div>
