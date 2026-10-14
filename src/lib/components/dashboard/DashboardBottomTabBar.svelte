<script>
  // Phone bottom bar: five labeled destinations, Erstellen in the middle.
  // Feed lives on Start (filter chips + "Zum Feed"), Meine Inhalte and
  // Gruppen in the avatar menu, Nachrichten inside Posteingang (?tab=messages).
  import { page } from '$app/stores';
  import { resolve } from '$app/paths';
  import { HomeIcon, SearchIcon, PlusIcon, BellIcon, PeopleIcon } from '$lib/components/icons';
  import { getTotalUnreadCount } from '$lib/services/inbox-service.svelte.js';
  import { openCreateHub } from '$lib/stores/create-hub.svelte.js';
  import { getDashboardActiveSection } from '$lib/helpers/dashboardNavigation.js';
  import * as m from '$lib/paraglide/messages';

  const items = [
    { id: 'home', href: resolve('/c/'), icon: HomeIcon, label: () => m.dashboard_nav_start() },
    {
      id: 'discover',
      href: resolve('/discover'),
      icon: SearchIcon,
      label: () => m.navbar_discover()
    },
    { id: 'create', href: null, icon: PlusIcon, label: () => m.dashboard_nav_create() },
    { id: 'inbox', href: resolve('/c/inbox'), icon: BellIcon, label: () => m.dashboard_nav_inbox() },
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
  let unread = $derived(getTotalUnreadCount());
</script>

<nav
  data-testid="mobile-dock"
  aria-label={m.dashboard_nav_aria()}
  class="pb-safe fixed right-0 bottom-0 left-0 z-50 border-t border-base-300 bg-base-200 lg:hidden"
>
  <div class="mx-auto flex items-stretch px-1 pt-1">
    {#each items as item (item.id)}
      {@const Icon = item.icon}
      {@const isActive = activeSection === item.id}
      {#if item.id === 'create'}
        <button
          type="button"
          data-testid="dock-create"
          class="dock-item"
          onclick={openCreateHub}
        >
          <span
            class="-mt-6 grid size-13 place-items-center rounded-full bg-accent text-accent-content shadow-lg"
          >
            <Icon class_="h-7 w-7" />
          </span>
          <span class="dock-label">{item.label()}</span>
        </button>
      {:else}
        <a
          href={item.href}
          data-testid="dock-{item.id}"
          class="dock-item"
          class:dock-on={isActive}
          aria-current={isActive ? 'page' : undefined}
        >
          <span class="relative">
            <Icon class_="h-6 w-6" />
            {#if item.id === 'inbox' && unread > 0}
              <span
                data-testid="dock-inbox-badge"
                class="absolute -top-1 -right-2 badge h-4 min-w-4 badge-sm px-1 text-[10px] badge-secondary"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            {/if}
          </span>
          <span class="dock-label">{item.label()}</span>
        </a>
      {/if}
    {/each}
  </div>
</nav>

<style>
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom);
  }
  .dock-item {
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    height: 3.5rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    color: var(--c-ink-soft);
  }
  .dock-item.dock-on {
    color: var(--c-ink);
  }
  .dock-item.dock-on :global(svg) {
    color: var(--color-primary);
  }
  .dock-label {
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }
</style>
