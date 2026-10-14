/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
  unread: 0,
  openCreateHub: vi.fn()
}));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$app/stores', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({ url: new URL('http://localhost/c/') });
  return { page: store, __setUrl: (/** @type {URL} */ u) => store.set({ url: u }) };
});
vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  getTotalUnreadCount: () => state.unread
}));
vi.mock('$lib/stores/create-hub.svelte.js', () => ({
  openCreateHub: () => state.openCreateHub()
}));
vi.mock('$lib/paraglide/messages', () => ({
  dashboard_nav_start: () => 'Start',
  navbar_discover: () => 'Entdecken',
  dashboard_nav_create: () => 'Erstellen',
  dashboard_nav_inbox: () => 'Posteingang',
  dashboard_nav_communities: () => 'Communities',
  dashboard_nav_aria: () => 'Hauptnavigation',
  fab_open_menu: () => 'Aktionsmenü öffnen'
}));

const { default: Dock } = await import('../dashboard/DashboardBottomTabBar.svelte');
const stores = /** @type {any} */ (await import('$app/stores'));

describe('DashboardBottomTabBar', () => {
  beforeEach(() => {
    state.unread = 0;
    state.openCreateHub.mockReset();
    stores.__setUrl(new URL('http://localhost/c/'));
  });

  it('shows exactly five labeled items in order', () => {
    const { getByTestId } = render(Dock);
    const nav = getByTestId('mobile-dock');
    const labels = [...nav.querySelectorAll('[data-testid^="dock-"] .dock-label')].map((el) =>
      el.textContent?.trim()
    );
    expect(labels).toEqual(['Start', 'Entdecken', 'Erstellen', 'Posteingang', 'Communities']);
  });

  it('links Start, Entdecken, Posteingang and Communities to their routes', () => {
    const { getByTestId } = render(Dock);
    expect(getByTestId('dock-home').getAttribute('href')).toBe('/c/');
    expect(getByTestId('dock-discover').getAttribute('href')).toBe('/discover');
    expect(getByTestId('dock-inbox').getAttribute('href')).toBe('/c/inbox');
    expect(getByTestId('dock-communities').getAttribute('href')).toBe('/c/?view=communities');
  });

  it('Erstellen is a button that opens the create hub', async () => {
    const { getByTestId } = render(Dock);
    const create = getByTestId('dock-create');
    expect(create.tagName).toBe('BUTTON');
    await fireEvent.click(create);
    expect(state.openCreateHub).toHaveBeenCalledTimes(1);
  });

  it('marks the active item with aria-current', () => {
    stores.__setUrl(new URL('http://localhost/discover?type=learning'));
    const { getByTestId } = render(Dock);
    expect(getByTestId('dock-discover').getAttribute('aria-current')).toBe('page');
    expect(getByTestId('dock-home').getAttribute('aria-current')).toBeNull();
  });

  it('shows the unread badge on Posteingang and hides it at zero', () => {
    state.unread = 3;
    const { getByTestId, unmount } = render(Dock);
    expect(getByTestId('dock-inbox-badge').textContent?.trim()).toBe('3');
    unmount();
    state.unread = 0;
    const second = render(Dock);
    expect(second.queryByTestId('dock-inbox-badge')).toBeNull();
  });

  it('caps the badge at 99+', () => {
    state.unread = 120;
    const { getByTestId } = render(Dock);
    expect(getByTestId('dock-inbox-badge').textContent?.trim()).toBe('99+');
  });

  it('gives every item the dock-item class that sets the 56px touch height', () => {
    const { getByTestId } = render(Dock);
    for (const id of ['home', 'discover', 'create', 'inbox', 'communities']) {
      expect(getByTestId(`dock-${id}`).className).toContain('dock-item');
    }
  });
});
