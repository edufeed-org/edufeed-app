/** @vitest-environment jsdom */
// src/lib/components/__tests__/CommunikeyCard.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import CommunikeyCard from '../CommunikeyCard.svelte';

const COMMUNITY_PUBKEY = 'a'.repeat(64);

/** @type {any} */
let profileData = { name: 'Test Community', about: 'Test description' };

/** @type {any} */
let communityType = null;

/** @type {any} */
let isMemberData = false;

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: vi.fn(() => () => profileData)
}));

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useCommunityMembership: vi.fn(() => () => isMemberData)
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: vi.fn(() => () => ({ pubkey: 'user-pubkey' }))
}));

vi.mock('$lib/stores/community-type.svelte.js', () => ({
  useCommunityType: vi.fn(() => () => communityType)
}));

vi.mock('$lib/helpers/community', () => ({
  joinCommunity: vi.fn(() => Promise.resolve({ success: true })),
  leaveCommunity: vi.fn(() => Promise.resolve({ success: true }))
}));

const leaveWholeCommunity = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('$lib/groups/leave-community.js', () => ({ leaveWholeCommunity }));

vi.mock('$lib/helpers/toast', () => ({
  showToast: vi.fn()
}));

vi.mock('$lib/helpers/nostrUtils', () => ({
  hexToNpub: vi.fn((hex) => 'npub_' + hex.substring(0, 8))
}));

vi.mock('$lib/paraglide/messages', () => ({
  communikey_card_profile_alt: () => 'Community avatar',
  communikey_card_unknown_user: () => 'Unknown community',
  communikey_card_no_bio: () => 'No bio',
  communikey_card_joined_badge: () => 'Joined',
  communikey_card_button_join: () => 'Join',
  communikey_card_button_leave: () => 'Leave',
  groups_leave_community: () => 'Leave community',
  groups_leave_community_confirm_title: () => 'Really leave?',
  groups_leave_community_confirm_body: () => 'You lose all channels.',
  common_cancel: () => 'Cancel',
  communikey_card_toast_login_required: () => 'Login required',
  communikey_card_toast_joined: () => 'Joined community',
  communikey_card_toast_joined_failed: () => 'Failed to join',
  communikey_card_toast_left: () => 'Left community',
  communikey_card_toast_left_failed: () => 'Failed to leave',
  communikey_card_toast_error: () => 'Error',
  community_type_moderated_title: () => 'Moderated',
  community_type_closed_title: () => 'Closed',
  community_type_moderated_body: () => 'Moderated body',
  community_type_closed_body: () => 'Closed body'
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

beforeEach(() => {
  profileData = { name: 'Test Community', about: 'Test description' };
  communityType = null;
  isMemberData = false;
  vi.clearAllMocks();
});

describe('CommunikeyCard', () => {
  it('renders community card with name', () => {
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY } });
    expect(screen.getByText('Test Community')).toBeTruthy();
  });

  it('renders community description', () => {
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY } });
    expect(screen.getByText('Test description')).toBeTruthy();
  });

  it('shows moderated badge when type is moderated', () => {
    communityType = 'moderated';
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY } });
    const badge = screen.queryByTestId('community-type-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain('🛡️');
  });

  it('shows closed badge when type is closed', () => {
    communityType = 'closed';
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY } });
    const badge = screen.queryByTestId('community-type-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain('🔒');
  });

  it('does not show badge when type is open', () => {
    communityType = 'open';
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY } });
    const badge = screen.queryByTestId('community-type-badge');
    expect(badge).toBeFalsy();
  });

  it('does not show badge when type is unknown (null)', () => {
    communityType = null;
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY } });
    const badge = screen.queryByTestId('community-type-badge');
    expect(badge).toBeFalsy();
  });

  it('hides join button for closed communities', () => {
    communityType = 'closed';
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY, showJoinButton: true } });
    const joinButton = screen.queryByRole('button');
    expect(joinButton).toBeFalsy();
  });

  it('shows join button for open communities when showJoinButton is true', () => {
    communityType = 'open';
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY, showJoinButton: true } });
    const joinButton = screen.queryByRole('button');
    expect(joinButton).toBeTruthy();
  });

  it('shows join button for moderated communities when showJoinButton is true', () => {
    communityType = 'moderated';
    render(CommunikeyCard, { props: { pubkey: COMMUNITY_PUBKEY, showJoinButton: true } });
    const joinButton = screen.queryByRole('button');
    expect(joinButton).toBeTruthy();
  });

  // Issue c379c8ff: the card's leave is the whole leave, not just an unfollow.
  describe('leaving', () => {
    const props = { pubkey: COMMUNITY_PUBKEY, showJoinButton: true };

    it('a moderated community asks first, then leaves root group and follow', async () => {
      communityType = 'moderated';
      isMemberData = true;
      render(CommunikeyCard, { props });

      await fireEvent.click(screen.getByText('Leave community'));
      expect(screen.getByTestId('community-leave-confirm').textContent).toContain(
        'You lose all channels.'
      );
      expect(leaveWholeCommunity).not.toHaveBeenCalled();

      await fireEvent.click(screen.getByTestId('community-leave-confirm-action'));
      await waitFor(() =>
        expect(leaveWholeCommunity).toHaveBeenCalledWith(COMMUNITY_PUBKEY, expect.anything())
      );
      await waitFor(() => expect(screen.queryByTestId('community-leave-confirm')).toBeNull());
    });

    it('cancel leaves nothing', async () => {
      communityType = 'moderated';
      isMemberData = true;
      render(CommunikeyCard, { props });

      await fireEvent.click(screen.getByText('Leave community'));
      await fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByTestId('community-leave-confirm')).toBeNull();
      expect(leaveWholeCommunity).not.toHaveBeenCalled();
    });

    it('an open community is unfollowed at once, without a dialog', async () => {
      communityType = 'open';
      isMemberData = true;
      render(CommunikeyCard, { props });

      await fireEvent.click(screen.getByText('Leave'));
      await waitFor(() => expect(leaveWholeCommunity).toHaveBeenCalled());
      expect(screen.queryByTestId('community-leave-confirm')).toBeNull();
    });
  });
});
