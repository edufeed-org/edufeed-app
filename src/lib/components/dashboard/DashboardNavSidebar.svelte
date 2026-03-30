<script>
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { DashboardIcon, BellIcon, ScrollTextIcon, PeopleIcon } from '$lib/components/icons';
  import { getUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  const sections = [
    { id: 'feed', href: resolve('/c/'), icon: DashboardIcon, label: () => m.dashboard_nav_feed() },
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

  let activeSection = $derived.by(() => {
    const path = $page.url.pathname;
    const resolvedInbox = resolve('/c/inbox');
    if (path === resolvedInbox || path === resolvedInbox + '/') return 'inbox';
    return $page.url.searchParams.get('view') || 'feed';
  });
</script>

<div
  class="fixed top-16 left-16 hidden h-[calc(100vh-8rem)] w-60 flex-col overflow-y-auto border-r border-base-300 bg-base-100 lg:flex"
>
  <div class="flex items-center gap-3 p-4">
    <div class="avatar">
      <div class="mask w-9 mask-hexagon-2">
        <img src={runtimeConfig.appLogo} alt={runtimeConfig.appName} class="object-cover" />
      </div>
    </div>
    <h2 class="truncate text-sm font-semibold text-base-content">{runtimeConfig.appName}</h2>
  </div>

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
          {#if section.id === 'inbox' && getUnreadCount() > 0}
            <span
              class="absolute -top-1.5 -right-2 badge h-4 min-w-4 badge-sm text-[10px] badge-primary"
            >
              {getUnreadCount() > 99 ? '99+' : getUnreadCount()}
            </span>
          {/if}
        </span>
        <span class="text-sm font-medium">{section.label()}</span>
      </a>
    {/each}
  </nav>
</div>
