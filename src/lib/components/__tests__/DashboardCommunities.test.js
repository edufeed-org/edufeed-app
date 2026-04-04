// @ts-nocheck
/**
 * DashboardCommunities Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import DashboardCommunities from '../dashboard/DashboardCommunities.svelte';

// Mock dependencies
const mockOpenModal = vi.fn();
const mockJoinedCommunities = vi.fn(() => []);

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...args) => mockOpenModal(...args) }
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('$lib/paraglide/messages', () => ({
  dashboard_communities_title: () => 'Your Communities',
  dashboard_communities_discover: () => 'Discover',
  dashboard_communities_create: () => 'Create',
  dashboard_communities_empty: () => "You haven't joined any communities yet.",
  dashboard_communities_explore: () => 'Explore communities'
}));

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => mockJoinedCommunities()
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

function StubComponent() {}

vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({
  default: StubComponent
}));

vi.mock('$lib/components/icons', () => ({
  PeopleIcon: StubComponent,
  SearchIcon: StubComponent,
  PlusIcon: StubComponent
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockJoinedCommunities.mockReturnValue([]);
});

describe('DashboardCommunities', () => {
  it('renders the section with title', () => {
    const { getByTestId, getByText } = render(DashboardCommunities);
    expect(getByTestId('dashboard-communities')).toBeTruthy();
    expect(getByText('Your Communities')).toBeTruthy();
  });

  it('renders Discover link pointing to /discover?type=communities', () => {
    const { getByText } = render(DashboardCommunities);
    const discoverLink = getByText('Discover').closest('a');
    expect(discoverLink).toBeTruthy();
    expect(discoverLink?.getAttribute('href')).toBe('/discover?type=communities');
  });

  it('renders Create button', () => {
    const { getByText } = render(DashboardCommunities);
    const createBtn = getByText('Create').closest('button');
    expect(createBtn).toBeTruthy();
  });

  it('Create button opens createCommunity modal', async () => {
    const { getByText } = render(DashboardCommunities);
    const createBtn = /** @type {Element} */ (getByText('Create').closest('button'));
    await fireEvent.click(createBtn);
    expect(mockOpenModal).toHaveBeenCalledWith('createCommunity');
  });

  it('shows empty state when no communities joined', () => {
    const { getByText } = render(DashboardCommunities);
    expect(getByText("You haven't joined any communities yet.")).toBeTruthy();
  });

  it('empty state explore link points to /discover?type=communities', () => {
    const { getByText } = render(DashboardCommunities);
    const exploreLink = getByText('Explore communities').closest('a');
    expect(exploreLink).toBeTruthy();
    expect(exploreLink?.getAttribute('href')).toBe('/discover?type=communities');
  });

  it('shows joined communities when present', () => {
    mockJoinedCommunities.mockReturnValue(['pubkey1', 'pubkey2']);
    const { container } = render(DashboardCommunities);
    const communityLinks = container.querySelectorAll(
      '[data-testid="dashboard-communities"] a[href^="/c/"]'
    );
    expect(communityLinks.length).toBe(2);
  });
});
