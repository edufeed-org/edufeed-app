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
  dashboard_communities_discover_subtitle: () => 'Find more communities',
  dashboard_communities_create: () => 'Create',
  dashboard_communities_create_subtitle: () => 'Start your own community',
  dashboard_communities_empty: () => "You haven't joined any communities yet."
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

  it('does not render Discover or Create buttons in the section header', () => {
    // Action affordances live as tiles in the grid, not as small buttons in the header.
    const { container } = render(DashboardCommunities);
    const header = /** @type {Element} */ (
      container.querySelector('[data-testid="dashboard-communities"] > div')
    );
    expect(header).toBeTruthy();
    expect(header.textContent).not.toContain('Discover');
    expect(header.textContent).not.toContain('Create');
  });

  it('renders the Discover community tile pointing to /discover?type=communities', () => {
    const { getByTestId } = render(DashboardCommunities);
    const card = getByTestId('dashboard-communities-discover-card');
    expect(card).toBeTruthy();
    expect(card.tagName).toBe('A');
    expect(card.getAttribute('href')).toBe('/discover?type=communities');
  });

  it('renders the Create community tile as a button', () => {
    const { getByTestId } = render(DashboardCommunities);
    const card = getByTestId('dashboard-communities-create-card');
    expect(card).toBeTruthy();
    expect(card.tagName).toBe('BUTTON');
  });

  it('Create tile opens the createCommunity modal', async () => {
    const { getByTestId } = render(DashboardCommunities);
    const card = getByTestId('dashboard-communities-create-card');
    await fireEvent.click(card);
    expect(mockOpenModal).toHaveBeenCalledWith('createCommunity');
  });

  it('renders Discover first and Create second in the grid', () => {
    mockJoinedCommunities.mockReturnValue(['pubkey1', 'pubkey2']);
    const { container } = render(DashboardCommunities);
    const grid = /** @type {Element} */ (
      container.querySelector('[data-testid="dashboard-communities-grid"]')
    );
    expect(grid).toBeTruthy();
    const children = Array.from(grid.children);
    expect(children[0].getAttribute('data-testid')).toBe('dashboard-communities-discover-card');
    expect(children[1].getAttribute('data-testid')).toBe('dashboard-communities-create-card');
  });

  it('shows the empty hint above the grid when no communities are joined', () => {
    const { getByText, getByTestId } = render(DashboardCommunities);
    expect(getByText("You haven't joined any communities yet.")).toBeTruthy();
    // Grid is still rendered (with Discover + Create tiles) — no wrapper card.
    expect(getByTestId('dashboard-communities-grid')).toBeTruthy();
  });

  it('hides the empty hint when communities are joined', () => {
    mockJoinedCommunities.mockReturnValue(['pubkey1', 'pubkey2']);
    const { container, getByTestId } = render(DashboardCommunities);
    expect(getByTestId('dashboard-communities-grid')).toBeTruthy();
    expect(container.textContent).not.toContain("haven't joined");
  });

  it('renders both action tiles even when empty', () => {
    const { getByTestId } = render(DashboardCommunities);
    expect(getByTestId('dashboard-communities-discover-card')).toBeTruthy();
    expect(getByTestId('dashboard-communities-create-card')).toBeTruthy();
  });
});
