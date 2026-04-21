/**
 * CommunityFilterDropdown Component Tests
 *
 * Tests the redesigned community filter dropdown with label-above layout,
 * regular sizing, and i18n support.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import CommunityFilterDropdown from '../feed/CommunityFilterDropdown.svelte';

// Mock paraglide messages
vi.mock('$lib/paraglide/messages', () => ({
  discover_community_label: () => 'Community:',
  community_filter_all: () => 'All',
  community_filter_my: () => 'My Communities',
  community_filter_joined: () => 'Joined',
  community_filter_discover: () => 'Discover'
}));

const joinedCommunities = [
  { pubkey: 'aaa111', name: 'Svelte Devs' },
  { pubkey: 'bbb222', name: 'Nostr Builders' }
];

const discoverCommunities = [{ pubkey: 'ccc333', name: 'Open Source' }];

describe('CommunityFilterDropdown', () => {
  it('renders with a label element above the select', () => {
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange: vi.fn()
      }
    });

    const label = container.querySelector('label');
    expect(label).toBeTruthy();

    // Label should use form-control pattern (label above, not inline)
    const wrapper = container.querySelector('.form-control');
    expect(wrapper).toBeTruthy();
  });

  it('renders a regular-sized select (not select-sm)', () => {
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange: vi.fn()
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    expect(select).toBeTruthy();
    expect(select.classList.contains('select-bordered')).toBe(true);
    // Should NOT have select-sm class (consistent sizing)
    expect(select.classList.contains('select-sm')).toBe(false);
  });

  it('renders "All" as default option', () => {
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange: vi.fn()
      }
    });

    const options = container.querySelectorAll('option');
    expect(options[0].textContent).toContain('All');
    expect(options[0].value).toBe('');
  });

  it('renders "My Communities" option when joined communities exist', () => {
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange: vi.fn()
      }
    });

    const options = Array.from(container.querySelectorAll('option'));
    const myCommOption = options.find((o) => o.value === 'joined');
    expect(myCommOption).toBeTruthy();
  });

  it('renders joined communities in an optgroup', () => {
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange: vi.fn()
      }
    });

    const groups = container.querySelectorAll('optgroup');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const joinedGroup = /** @type {HTMLOptGroupElement} */ (
      Array.from(groups).find((g) => /** @type {HTMLOptGroupElement} */ (g).label === 'Joined')
    );
    expect(joinedGroup).toBeTruthy();
    expect(joinedGroup.querySelectorAll('option').length).toBe(2);
  });

  it('renders discover communities in an optgroup', () => {
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange: vi.fn()
      }
    });

    const groups = container.querySelectorAll('optgroup');
    const discoverGroup = /** @type {HTMLOptGroupElement} */ (
      Array.from(groups).find((g) => /** @type {HTMLOptGroupElement} */ (g).label === 'Discover')
    );
    expect(discoverGroup).toBeTruthy();
    expect(discoverGroup.querySelectorAll('option').length).toBe(1);
  });

  it('calls onchange with null when "All" is selected', async () => {
    const onchange = vi.fn();
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: 'joined',
        joinedCommunities,
        discoverCommunities,
        onchange
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    await fireEvent.change(select, { target: { value: '' } });
    expect(onchange).toHaveBeenCalledWith(null);
  });

  it('calls onchange with "joined" when My Communities is selected', async () => {
    const onchange = vi.fn();
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    await fireEvent.change(select, { target: { value: 'joined' } });
    expect(onchange).toHaveBeenCalledWith('joined');
  });

  it('calls onchange with pubkey when specific community is selected', async () => {
    const onchange = vi.fn();
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    await fireEvent.change(select, { target: { value: 'aaa111' } });
    expect(onchange).toHaveBeenCalledWith('aaa111');
  });

  it('disables select when disabled prop is true', () => {
    const { container } = render(CommunityFilterDropdown, {
      props: {
        value: null,
        joinedCommunities,
        discoverCommunities,
        onchange: vi.fn(),
        disabled: true
      }
    });

    const select = /** @type {HTMLSelectElement} */ (container.querySelector('select'));
    expect(select.disabled).toBe(true);
  });
});
