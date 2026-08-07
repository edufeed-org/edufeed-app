// @ts-nocheck
/**
 * DashboardNavSidebar Component Tests — Communities pending-invite badge
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DashboardNavSidebar from '../dashboard/DashboardNavSidebar.svelte';

const mockGetPendingInviteCount = vi.fn(() => 0);

function StubComponent() {}

vi.mock('$lib/components/icons', () => ({
  HomeIcon: StubComponent,
  GridIcon: StubComponent,
  BellIcon: StubComponent,
  MessageSquareIcon: StubComponent,
  BookmarkIcon: StubComponent,
  PeopleIcon: StubComponent,
  LockIcon: StubComponent
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('$app/stores', () => {
  const { writable } = require('svelte/store');
  const store = writable({
    url: new URL('http://localhost/c/')
  });
  return { page: store };
});

vi.mock('$lib/helpers/dashboardNavigation.js', () => ({
  getDashboardActiveSection: () => 'home'
}));

vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  getTotalUnreadCount: () => 0
}));

vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getUnreadDmCount: () => 0
}));

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { cordnGroupsEnabled: false }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { cordnGroups: undefined }
}));

vi.mock('$lib/cordn', () => ({
  parseCordnGroupsConfig: () => ({ enabled: false })
}));

vi.mock('$lib/concord/pending-invites.svelte.js', () => ({
  getPendingInviteCount: (/** @type {any[]} */ ...args) => mockGetPendingInviteCount(...args)
}));

vi.mock('$lib/paraglide/messages', () => ({
  dashboard_nav_home: () => 'Home',
  dashboard_nav_feed: () => 'Feed',
  dashboard_nav_inbox: () => 'Inbox',
  dashboard_nav_messages: () => 'Messages',
  dashboard_nav_my_stuff: () => 'My Stuff',
  dashboard_nav_communities: () => 'Communities',
  dashboard_nav_groups: () => 'Groups'
}));

describe('DashboardNavSidebar Communities invite badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a badge with the pending invite count on Communities', () => {
    mockGetPendingInviteCount.mockReturnValue(2);
    render(DashboardNavSidebar);
    const badge = screen.getByTestId('communities-invite-badge');
    expect(badge.textContent.trim()).toBe('2');
  });

  it('hides the invite badge when there are no pending invites', () => {
    mockGetPendingInviteCount.mockReturnValue(0);
    render(DashboardNavSidebar);
    expect(screen.queryByTestId('communities-invite-badge')).toBeNull();
  });
});
