/**
 * CommunityProfileHero — closed-community handling (Plan 4 / Task 2) and the
 * moderated-community join lane (Plan 4 / Task 4).
 *
 * A closed community (concord pointer tag, no membership pointer) shows the
 * "Closed" badge + an invitation-only hint and MUST NOT render the
 * join/leave button — the kind-30000 follow join is meaningless there.
 * Open communities (no pointers) keep today's Join button behavior.
 *
 * A moderated community (membership pointer) runs an INDEPENDENT roster-based
 * join lane beside the kind-30000 follow button: a "Mitglied" badge for
 * roster members, and — for non-members — either the existing
 * application-form button (unchanged) or a bare-9021 join button plus an
 * always-available invite-code redeem affordance.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { channelKey } from '$lib/groups/community-pointer.js';

vi.mock('$lib/paraglide/messages', () => ({
  communikey_header_join_button: () => 'Follow Community',
  communikey_header_joined_badge: () => 'Following',
  community_request_join: () => 'Apply to Join',
  community_members_count: (/** @type {{count: number}} */ { count }) => `${count} members`,
  community_profile_hero_more: () => 'more',
  community_type_closed_title: () => 'Closed',
  community_hero_closed_hint: () => 'Invitation only',
  community_join_group: () => 'Join',
  community_join_request: () => 'Request to join',
  community_join_pending: () => 'Request sent — waiting for approval.',
  community_join_member: () => 'Member',
  community_join_invite_toggle: () => 'Redeem invite code',
  community_join_invite_placeholder: () => 'Code',
  community_join_invite_lead: () => 'Enter the invite code.',
  common_cancel: () => 'Cancel',
  community_join_invite_submit: () => 'Redeem',
  community_join_refused: () => 'The relay declined this join request.',
  community_join_failed: (/** @type {{reason: string}} */ { reason }) => `Join failed: ${reason}`
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// A real (if minimal) store contract instead of the previous no-op stub: the
// ?join= prefill effect (Task A6) reads $page.url.searchParams on mount, so
// tests need a subscribe that actually delivers a value. Tests that care set
// pageUrlHolder.url before render(); everything else gets the plain default.
const pageUrlHolder = vi.hoisted(() => ({ url: new URL('http://localhost/c/test') }));
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (/** @type {(value: any) => void} */ fn) => {
      fn({ url: pageUrlHolder.url, data: {} });
      return () => {};
    }
  }
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const holders = vi.hoisted(() => ({
  joined: false,
  activeUser: /** @type {any} */ (null),
  rosterPointer: /** @type {any} */ (null),
  isMember: false,
  isRosterLoading: false,
  refresh: vi.fn(),
  metadataByKey: /** @type {Record<string, any>} */ ({})
}));
vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useCommunityMembership: () => () => holders.joined
}));
vi.mock('$lib/helpers/community', () => ({ joinCommunity: vi.fn() }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => holders.activeUser
}));
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => ({
    pointer: holders.rosterPointer,
    refresh: holders.refresh,
    members: new Set(),
    admins: [],
    isLoading: holders.isRosterLoading,
    isMember: () => holders.isMember,
    rolesOf: () => []
  })
}));
vi.mock('$lib/groups/channel-metadata.svelte.js', () => ({
  useChannelMetadata: () => () => ({ byKey: holders.metadataByKey, failedRelays: [] })
}));
vi.mock('$lib/groups/join-community-group.js', () => ({
  joinCommunityGroup: vi.fn()
}));

const formRefHolder = vi.hoisted(() => ({ value: /** @type {string | null} */ (null) }));
vi.mock('svelte', async (importOriginal) => {
  const actual = /** @type {Record<string, any>} */ (await importOriginal());
  return {
    ...actual,
    getContext: (/** @type {string} */ key) =>
      key === 'communityWideFormRef' ? () => formRefHolder.value : undefined
  };
});

vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: function Stub() {} }));
vi.mock('../../shared/ImageWithFallback.svelte', () => ({ default: function Stub() {} }));

import CommunityProfileHero from '$lib/components/community/views/CommunityProfileHero.svelte';
import { joinCommunityGroup } from '$lib/groups/join-community-group.js';
import { showToast } from '$lib/helpers/toast';

const OPEN_EVENT = { kind: 10222, tags: [] };
const CLOSED_EVENT = {
  kind: 10222,
  tags: [['concord', 'a'.repeat(64), 'wss://concord.example.org']]
};

const ROOT_ID = 'root123abcdef456';
const ROOT_RELAY = 'wss://groups.example';
const MODERATED_EVENT = {
  kind: 10222,
  tags: [['membership', ROOT_ID, ROOT_RELAY]]
};
const ROOT_POINTER = { id: ROOT_ID, relay: ROOT_RELAY };

const PROFILE_EVENT = { content: JSON.stringify({ name: 'Test Community' }) };
const USER = { pubkey: 'b'.repeat(64), signer: {} };

function renderModerated(/** @type {any} */ extraProps = {}) {
  return render(CommunityProfileHero, {
    props: {
      communityId: 'x'.repeat(64),
      communikeyEvent: MODERATED_EVENT,
      profileEvent: PROFILE_EVENT,
      onNavigateToAbout: vi.fn(),
      onMembersClick: vi.fn(),
      ...extraProps
    }
  });
}

describe('CommunityProfileHero — community type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holders.joined = false;
    holders.activeUser = null;
    holders.rosterPointer = null;
    holders.isMember = false;
    holders.metadataByKey = {};
    formRefHolder.value = null;
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

const ROOT_KEY = /** @type {string} */ (channelKey(ROOT_POINTER));
const OPEN_ROOT_METADATA = { kind: 39000, tags: [['d', ROOT_ID]] };

describe('CommunityProfileHero — moderated join lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holders.joined = false;
    holders.activeUser = USER;
    holders.rosterPointer = ROOT_POINTER;
    holders.isMember = false;
    holders.isRosterLoading = false;
    // Default: root 39000 has already arrived and is NOT closed — most tests
    // below exercise the non-loading, non-closed steady state. Tests for the
    // loading/unloaded/closed edges override this explicitly.
    holders.metadataByKey = { [ROOT_KEY]: OPEN_ROOT_METADATA };
    formRefHolder.value = null;
    pageUrlHolder.url = new URL('http://localhost/c/test');
  });

  it('roster member: shows the Member badge, no join affordances', () => {
    holders.isMember = true;
    renderModerated();

    expect(screen.getAllByText('Member').length).toBeGreaterThan(0);
    expect(screen.queryByText('Join')).toBeNull();
    expect(screen.queryByText('Redeem invite code')).toBeNull();
  });

  // The application-form join path is gone (YAGNI, 2026-08-18):
  // useCommunityAccess returns no form ref for moderated communities, and
  // the moderated lane no longer defers to one — even a stale context value
  // (e.g. mid-flight state) must not suppress the invite-code affordance.
  it('non-member with a (stale) form ref: the moderated join lane renders anyway', () => {
    formRefHolder.value = '30168:' + 'c'.repeat(64) + ':membership';
    renderModerated();

    expect(screen.getAllByText('Join').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Redeem invite code').length).toBeGreaterThan(0);
  });

  it('non-member, no application ref, root group not closed: shows the group Join button', () => {
    renderModerated();

    expect(screen.getAllByText('Join').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Redeem invite code').length).toBeGreaterThan(0);
  });

  // A closed root STORES bare 9021s (verified live on groups.0xchat.com) and
  // they land in the admins' Beitrittsanfragen queue — so the request button
  // stays, with request-for-approval wording instead of instant "Join".
  it('non-member, root group closed: offers "Request to join" instead of instant Join', () => {
    holders.metadataByKey = {
      [ROOT_KEY]: { kind: 39000, tags: [['d', ROOT_ID], ['closed']] }
    };
    renderModerated();

    expect(screen.getAllByText('Request to join').length).toBeGreaterThan(0);
    expect(screen.queryByText('Join')).toBeNull();
    expect(screen.getAllByText('Redeem invite code').length).toBeGreaterThan(0);
  });

  it('root 39000 not yet loaded (empty byKey): counts as closed — request wording, no instant Join', () => {
    holders.metadataByKey = {};
    renderModerated();

    expect(screen.getAllByText('Request to join').length).toBeGreaterThan(0);
    expect(screen.queryByText('Join')).toBeNull();
    expect(screen.getAllByText('Redeem invite code').length).toBeGreaterThan(0);
  });

  it('roster still loading: renders no join affordances at all (not even invite-code)', () => {
    holders.isRosterLoading = true;
    renderModerated();

    expect(screen.queryByText('Join')).toBeNull();
    expect(screen.queryByText('Redeem invite code')).toBeNull();
    expect(screen.queryByText('Member')).toBeNull();
  });

  it('anonymous: no moderated join affordances at all', () => {
    holders.activeUser = null;
    renderModerated();

    expect(screen.queryByText('Join')).toBeNull();
    expect(screen.queryByText('Redeem invite code')).toBeNull();
    expect(screen.queryByText('Member')).toBeNull();
  });

  it('invite-code input submits with the typed code', async () => {
    const service = /** @type {import('vitest').Mock} */ (joinCommunityGroup);
    service.mockResolvedValueOnce(undefined);
    renderModerated();

    await fireEvent.click(screen.getByText('Redeem invite code'));
    const input = screen.getByLabelText('Code');
    await fireEvent.input(input, { target: { value: 'sekrit' } });
    await fireEvent.click(screen.getByText('Redeem'));

    await waitFor(() =>
      expect(service).toHaveBeenCalledWith({
        pointer: ROOT_POINTER,
        code: 'sekrit',
        user: USER
      })
    );
    await waitFor(() =>
      expect(screen.getAllByText('Request sent — waiting for approval.').length).toBeGreaterThan(0)
    );
    expect(holders.refresh).toHaveBeenCalled();
  });

  it('bare join button sends a plain request and flips to the pending state', async () => {
    const service = /** @type {import('vitest').Mock} */ (joinCommunityGroup);
    service.mockResolvedValueOnce(undefined);
    renderModerated();

    await fireEvent.click(screen.getByText('Join'));

    await waitFor(() =>
      expect(service).toHaveBeenCalledWith({ pointer: ROOT_POINTER, user: USER })
    );
    await waitFor(() =>
      expect(screen.getAllByText('Request sent — waiting for approval.').length).toBeGreaterThan(0)
    );
  });

  it('pending state (requestSent): keeps the invite-code affordance alongside the pending message', async () => {
    // Redeeming a code is always legitimate, even with a bare 9021 already
    // outstanding — the pending message must not replace the toggle/input.
    const service = /** @type {import('vitest').Mock} */ (joinCommunityGroup);
    service.mockResolvedValueOnce(undefined);
    renderModerated();

    await fireEvent.click(screen.getByText('Join'));
    await waitFor(() =>
      expect(screen.getAllByText('Request sent — waiting for approval.').length).toBeGreaterThan(0)
    );

    // Invite toggle is still rendered in the pending state.
    expect(screen.getAllByText('Redeem invite code').length).toBeGreaterThan(0);

    // And the input still works from the pending state.
    await fireEvent.click(screen.getByText('Redeem invite code'));
    expect(screen.getByPlaceholderText('Code')).toBeTruthy();
  });

  it('a membership-refusal error gets the friendlier toast', async () => {
    const service = /** @type {import('vitest').Mock} */ (joinCommunityGroup);
    service.mockRejectedValueOnce(new Error('not a member'));
    renderModerated();

    await fireEvent.click(screen.getByText('Join'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('The relay declined this join request.', 'error')
    );
  });

  it('any other relay rejection toasts the raw reason', async () => {
    const service = /** @type {import('vitest').Mock} */ (joinCommunityGroup);
    service.mockRejectedValueOnce(new Error('rate limited'));
    renderModerated();

    await fireEvent.click(screen.getByText('Join'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Join failed: rate limited', 'error')
    );
  });

  // Task A6: a DM invite link carries `?join=<code>` — the modal opens and
  // prefills, but redeeming stays the recipient's explicit click (consent
  // on arrival), never automatic on page load.
  it('a ?join= param prefills and opens the invite-code modal; submit is still the explicit consent', async () => {
    pageUrlHolder.url = new URL('http://localhost/c/test?join=CODE123');
    const service = /** @type {import('vitest').Mock} */ (joinCommunityGroup);
    service.mockResolvedValueOnce(undefined);
    renderModerated();

    const input = /** @type {HTMLInputElement} */ (screen.getByLabelText('Code'));
    expect(input.value).toBe('CODE123');
    expect(service).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByText('Redeem'));

    await waitFor(() =>
      expect(service).toHaveBeenCalledWith({ pointer: ROOT_POINTER, code: 'CODE123', user: USER })
    );
  });
});
