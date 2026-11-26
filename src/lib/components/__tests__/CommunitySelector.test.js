/**
 * CommunitySelector: the community being visited is pinned on top, the
 * others sit behind one toggle.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import CommunitySelector from '../calendar/CommunitySelector.svelte';

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: (/** @type {string} */ pubkey) => () => ({ name: `name-${pubkey}` })
}));
vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.name
}));
function Stub() {}
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: Stub }));

const rows = (/** @type {HTMLElement} */ c) =>
  [...c.querySelectorAll('[data-testid="community-row"]')].map((r) => r.textContent?.trim());
const box = (/** @type {HTMLElement} */ c, /** @type {number} */ i) =>
  /** @type {HTMLInputElement} */ (c.querySelectorAll('input[type="checkbox"]')[i]);

describe('CommunitySelector', () => {
  it('pins the current community and hides the rest behind the toggle', async () => {
    const { container, getByTestId } = render(CommunitySelector, {
      props: {
        communities: ['a', 'here', 'b'],
        selectedCommunityIds: ['here'],
        currentCommunity: 'here'
      }
    });
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0]).toContain('name-here');
    expect(box(container, 0).checked).toBe(true);

    const toggle = getByTestId('community-more-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(rows(container).map((t) => t?.split(/\s/)[0])).toEqual([
      'name-here',
      'name-a',
      'name-b'
    ]);
  });

  it('without a current community the list is open and has no toggle', () => {
    const { container, queryByTestId } = render(CommunitySelector, {
      props: { communities: ['a', 'b'], selectedCommunityIds: [] }
    });
    expect(rows(container)).toHaveLength(2);
    expect(queryByTestId('community-more-toggle')).toBeNull();
  });

  it('a current community outside the list is not pinned', () => {
    const { container } = render(CommunitySelector, {
      props: { communities: ['a'], selectedCommunityIds: [], currentCommunity: 'gone' }
    });
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0]).toContain('name-a');
  });

  it('a restricted community is disabled', () => {
    const { container, getByTestId } = render(CommunitySelector, {
      props: { communities: ['a'], selectedCommunityIds: [], restrictedCommunities: new Set(['a']) }
    });
    expect(box(container, 0).disabled).toBe(true);
    expect(getByTestId('share-restricted-badge')).toBeTruthy();
  });
});
