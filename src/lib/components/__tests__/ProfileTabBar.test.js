// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ProfileTabBar from '../profile/ProfileTabBar.svelte';

const TABS = [
  { id: 'posts', label: 'Beiträge', count: 12 },
  { id: 'content', label: 'Inhalte', count: 0 },
  { id: 'badges', label: 'Abzeichen', count: 3 }
];

describe('<ProfileTabBar>', () => {
  it('renders one tab button per entry with its label', () => {
    const { getByText } = render(ProfileTabBar, {
      tabs: TABS,
      activeTab: 'posts',
      onSelect: vi.fn()
    });
    expect(getByText('Beiträge')).toBeTruthy();
    expect(getByText('Inhalte')).toBeTruthy();
    expect(getByText('Abzeichen')).toBeTruthy();
  });

  it('marks the active tab', () => {
    const { container } = render(ProfileTabBar, {
      tabs: TABS,
      activeTab: 'content',
      onSelect: vi.fn()
    });
    const active = container.querySelector('[data-testid="profile-tab-content"]');
    expect(active?.className).toMatch(/\bon\b/);
    expect(container.querySelector('[data-testid="profile-tab-posts"]')?.className).not.toMatch(
      /\bon\b/
    );
  });

  it('shows counts only when greater than zero', () => {
    const { container } = render(ProfileTabBar, {
      tabs: TABS,
      activeTab: 'posts',
      onSelect: vi.fn()
    });
    expect(container.querySelector('[data-testid="profile-tab-posts"]')?.textContent).toContain(
      '12'
    );
    expect(
      container.querySelector('[data-testid="profile-tab-content"]')?.textContent
    ).not.toContain('0');
  });

  it('calls onSelect with the tab id', async () => {
    const onSelect = vi.fn();
    const { container } = render(ProfileTabBar, { tabs: TABS, activeTab: 'posts', onSelect });
    container.querySelector('[data-testid="profile-tab-badges"]').click();
    expect(onSelect).toHaveBeenCalledWith('badges');
  });
});
