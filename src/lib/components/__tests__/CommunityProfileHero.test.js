/**
 * CommunityProfileHero — closed-community handling (Plan 4 / Task 2).
 *
 * A closed community (concord pointer tag, no membership pointer) shows the
 * "Closed" badge + an invitation-only hint and MUST NOT render the
 * join/leave button — the kind-30000 follow join is meaningless there.
 * Open communities (no pointers) keep today's Join button behavior.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  communikey_header_join_button: () => 'Follow Community',
  communikey_header_joined_badge: () => 'Following',
  community_request_join: () => 'Apply to Join',
  community_members_count: (/** @type {{count: number}} */ { count }) => `${count} members`,
  community_profile_hero_more: () => 'more',
  community_type_closed_title: () => 'Closed',
  community_hero_closed_hint: () => 'Invitation only'
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/stores', () => ({ page: { subscribe: () => () => {} } }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const holders = vi.hoisted(() => ({ joined: false }));
vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useCommunityMembership: () => () => holders.joined
}));
vi.mock('$lib/helpers/community', () => ({ joinCommunity: vi.fn() }));

vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: function Stub() {} }));
vi.mock('../../shared/ImageWithFallback.svelte', () => ({ default: function Stub() {} }));

import CommunityProfileHero from '$lib/components/community/views/CommunityProfileHero.svelte';

const OPEN_EVENT = { kind: 10222, tags: [] };
const CLOSED_EVENT = {
  kind: 10222,
  tags: [['concord', 'a'.repeat(64), 'wss://concord.example.org']]
};

const PROFILE_EVENT = { content: JSON.stringify({ name: 'Test Community' }) };

describe('CommunityProfileHero — community type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holders.joined = false;
  });

  it('closed: renders the Closed badge and hint, no Join button', () => {
    render(CommunityProfileHero, {
      props: {
        communityId: 'x'.repeat(64),
        communikeyEvent: CLOSED_EVENT,
        profileEvent: PROFILE_EVENT,
        onNavigateToAbout: vi.fn(),
        onMembersClick: vi.fn()
      }
    });

    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Invitation only').length).toBeGreaterThan(0);
    expect(screen.queryByText('Follow Community')).toBeNull();
    expect(screen.queryByText('Apply to Join')).toBeNull();
  });

  it('open: renders the Join button, no Closed badge', () => {
    render(CommunityProfileHero, {
      props: {
        communityId: 'x'.repeat(64),
        communikeyEvent: OPEN_EVENT,
        profileEvent: PROFILE_EVENT,
        onNavigateToAbout: vi.fn(),
        onMembersClick: vi.fn()
      }
    });

    expect(screen.getAllByText('Follow Community').length).toBeGreaterThan(0);
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.queryByText('Invitation only')).toBeNull();
  });
});
