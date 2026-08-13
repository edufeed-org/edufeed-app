/** @vitest-environment jsdom */
// src/lib/components/__tests__/CommunikeyCard.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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
  communikey_card_toast_login_required: () => 'Login required',
  communikey_card_toast_joined: () => 'Joined community',
  communikey_card_toast_joined_failed: () => 'Failed to join',
  communikey_card_toast_left: () => 'Left community',
  communikey_card_toast_left_failed: () => 'Failed to leave',
  communikey_card_toast_error: () => 'Error',
  community_type_moderated_title: () => 'Moderated',
  community_type_closed_title: () => 'Closed'
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
});
