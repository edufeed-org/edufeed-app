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

function StubComponent() {}

vi.mock('$lib/components/CommunikeyCard.svelte', () => ({
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

  it('does not render a Create button in the section header', () => {
    const { container } = render(DashboardCommunities);
    // Header has the title and Discover link only — no Create button alongside them
    const header = /** @type {Element} */ (
      container.querySelector('[data-testid="dashboard-communities"] > div')
    );
    expect(header).toBeTruthy();
    const headerCreateBtn = Array.from(header.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim().includes('Create')
    );
    expect(headerCreateBtn).toBeFalsy();
  });

  it('renders the prominent Create community card', () => {
    const { getByTestId } = render(DashboardCommunities);
    const card = getByTestId('dashboard-communities-create-card');
    expect(card).toBeTruthy();
    expect(card.tagName).toBe('BUTTON');
  });

  it('Create card opens createCommunity modal', async () => {
    const { getByTestId } = render(DashboardCommunities);
    const card = getByTestId('dashboard-communities-create-card');
    await fireEvent.click(card);
    expect(mockOpenModal).toHaveBeenCalledWith('createCommunity');
  });

  it('Create card is the first item in the populated grid', () => {
    mockJoinedCommunities.mockReturnValue(['pubkey1', 'pubkey2']);
    const { container } = render(DashboardCommunities);
    const grid = /** @type {Element} */ (
      container.querySelector('[data-testid="dashboard-communities-grid"]')
    );
    expect(grid).toBeTruthy();
    const firstChild = grid.firstElementChild;
    expect(firstChild?.getAttribute('data-testid')).toBe('dashboard-communities-create-card');
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

  it('empty state also renders the Create card alongside Explore', () => {
    const { getByTestId, getByText } = render(DashboardCommunities);
    expect(getByText('Explore communities')).toBeTruthy();
    expect(getByTestId('dashboard-communities-create-card')).toBeTruthy();
  });

  it('renders the Create card and hides the empty state when communities are joined', () => {
    mockJoinedCommunities.mockReturnValue(['pubkey1', 'pubkey2']);
    const { getByTestId, container } = render(DashboardCommunities);
    expect(getByTestId('dashboard-communities-grid')).toBeTruthy();
    expect(getByTestId('dashboard-communities-create-card')).toBeTruthy();
    expect(container.textContent).not.toContain("haven't joined");
  });
});
