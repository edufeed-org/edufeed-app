// @ts-nocheck
/**
 * FollowListModal — the people behind "N Follower" / "M Gefolgt" on a
 * profile: the viewer's own follows first, a page at a time.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import FollowListModal from '../profile/FollowListModal.svelte';

vi.mock(
  '$lib/components/shared/ProfileCard.svelte',
  () => import('./fixtures/ProfileCardStub.svelte')
);
vi.mock('$lib/paraglide/messages', () => ({
  common_close: () => 'Close',
  common_show_more: () => 'Show more',
  profile_follow_list_you_follow: () => 'you follow'
}));

const pk = (i) => i.toString(16).padStart(64, '0');
const rows = (container) =>
  [...container.querySelectorAll('[data-testid="follow-list-row"]')].map((el) => el.dataset.pubkey);

describe('FollowListModal', () => {
  it('lists the viewer’s follows first and marks them', () => {
    const { container } = render(FollowListModal, {
      props: {
        title: 'Followers',
        pubkeys: [pk(1), pk(2), pk(3)],
        viewerFollows: [pk(3)],
        onclose: vi.fn()
      }
    });
    expect(container.textContent).toContain('Followers');
    expect(rows(container)).toEqual([pk(3), pk(1), pk(2)]);
    const marks = container.querySelectorAll('[data-testid="follow-list-known"]');
    expect(marks).toHaveLength(1);
  });

  it('shows a page of 50 and more on request', async () => {
    const pubkeys = Array.from({ length: 60 }, (_, i) => pk(i + 1));
    const { container, getByRole } = render(FollowListModal, {
      props: { title: 'Followers', pubkeys, viewerFollows: [], onclose: vi.fn() }
    });
    expect(rows(container)).toHaveLength(50);
    await fireEvent.click(getByRole('button', { name: 'Show more' }));
    expect(rows(container)).toHaveLength(60);
  });

  it('closes', async () => {
    const onclose = vi.fn();
    const { getAllByRole } = render(FollowListModal, {
      props: { title: 'Followers', pubkeys: [pk(1)], viewerFollows: [], onclose }
    });
    // The action button and the backdrop both close.
    const [button, backdrop] = getAllByRole('button', { name: 'Close' });
    await fireEvent.click(button);
    await fireEvent.click(backdrop);
    expect(onclose).toHaveBeenCalledTimes(2);
  });
});
