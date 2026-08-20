/** @vitest-environment jsdom */
/**
 * SettingsView — Community-Typ pane (Task 6). Locks in: the flip buttons
 * render for the right community type + owner, are hidden entirely (not
 * merely disabled) for a non-owner, and the flip-to-open confirm publishes
 * a 10222 template whose tags derive back to 'open' (community-flips.js is
 * unit-tested elsewhere; this only proves the wiring).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { deriveCommunityType } from '$lib/groups/community-membership.js';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';

const mockManager = vi.hoisted(() => ({
  active: /** @type {any} */ ({ pubkey: 'a'.repeat(64), signer: { sign: () => {} } }),
  getAccountForPubkey: vi.fn((/** @type {string} */ pk) =>
    pk === 'a'.repeat(64) ? { signer: { sign: () => {} } } : null
  )
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active,
  accountsMeta: { version: 0 }
}));

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useCommunityMembership: () => () => true
}));

const concordFixture = vi.hoisted(() => /** @type {{ value: any }} */ ({ value: null }));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordCommunity: () => () => concordFixture.value
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));

const publishCommunityUpdate = vi.hoisted(() => vi.fn(async (template) => template));
vi.mock('$lib/helpers/publishCommunityUpdate.js', () => ({ publishCommunityUpdate }));

const provisionRootGroup = vi.hoisted(() =>
  vi.fn(async () => ({ id: 'newroot', relay: GROUPS_RELAY }))
);
const writeRootGroupMarker = vi.hoisted(() => vi.fn());
const clearRootGroupMarker = vi.hoisted(() => vi.fn());
vi.mock('$lib/groups/provision-root-group.js', () => ({
  provisionRootGroup,
  readRootGroupMarker: vi.fn(() => null),
  writeRootGroupMarker,
  clearRootGroupMarker
}));

const teardownCommunityGroups = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/groups/community-teardown.js', () => ({ teardownCommunityGroups }));

const moderatedAvailable = vi.hoisted(() => ({ value: true }));
vi.mock('$lib/groups/feature.js', () => ({
  moderatedCreationAvailable: () => moderatedAvailable.value
}));

// Rendered for owner-only scenarios (the Admin Settings section mounts it).
// Stub its network loaders so the effect never opens a real relay socket.
vi.mock('$lib/loaders/community.js', () => ({
  formTemplateLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

// MembershipPane (Task 8) mounts for any signed-in user on a moderated
// community (Task 3: no owner gate at this level any more — see there).
// Stub its roster hook so the effect never opens a real relay socket; its
// own wiring (including the isAdmin gate) is covered by
// MembershipPane.test.js. Mutable via rosterFixture so a test can seat the
// active user as a roster admin and prove MembershipPane actually renders
// for a non-owner.
const rosterFixture = vi.hoisted(
  () =>
    /** @type {{ value: any }} */ ({
      value: {
        pointer: null,
        refresh: vi.fn(),
        members: new Set(),
        admins: [],
        isLoading: false,
        isMember: () => false,
        rolesOf: () => []
      }
    })
);
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => rosterFixture.value
}));

const { default: SettingsView } = await import(
  '$lib/components/community/views/SettingsView.svelte'
);

const profileEvent = {
  kind: 0,
  pubkey: OWNER,
  tags: [],
  content: JSON.stringify({ name: 'Test Community' })
};

/** @param {string[][]} tags @param {string} [pubkey] */
function communikeyEvent(tags, pubkey = OWNER) {
  return { kind: 10222, pubkey, created_at: 1000, content: 'desc', tags };
}

const moderatedEvent = communikeyEvent([
  ['membership', 'rootgroup1', GROUPS_RELAY],
  ['group', 'ch1', GROUPS_RELAY, 'General'],
  ['group', 'ch2', GROUPS_RELAY, 'Random']
]);

// Same moderated community, but owned by someone other than the signed-in
// user — proves the MembershipPane mount condition no longer requires
// isOwner (Task 3: approvals reachability).
const moderatedStrangerEvent = communikeyEvent(
  [
    ['membership', 'rootgroup1', GROUPS_RELAY],
    ['group', 'ch1', GROUPS_RELAY, 'General']
  ],
  STRANGER
);

const openEvent = communikeyEvent([]);

beforeEach(() => {
  toastSpy.mockClear();
  publishCommunityUpdate.mockClear();
  provisionRootGroup.mockClear();
  teardownCommunityGroups.mockClear();
  writeRootGroupMarker.mockClear();
  clearRootGroupMarker.mockClear();
  moderatedAvailable.value = true;
  concordFixture.value = { enabled: false, pointer: null, community: null };
  rosterFixture.value = {
    pointer: null,
    refresh: vi.fn(),
    members: new Set(),
    admins: [],
    isLoading: false,
    isMember: () => false,
    rolesOf: () => []
  };
});

describe('SettingsView — Community-Typ pane', () => {
  it('renders the flip-to-open button for a moderated community (owner)', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: moderatedEvent, profileEvent }
    });
    expect(await screen.findByTestId('settings-type-card')).toBeTruthy();
    expect(screen.getByTestId('settings-flip-to-open')).toBeTruthy();
    expect(screen.queryByTestId('settings-flip-to-moderated')).toBeNull();
  });

  it('renders the flip-to-moderated button for an open community when the feature is available', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent }
    });
    expect(await screen.findByTestId('settings-type-card')).toBeTruthy();
    expect(screen.getByTestId('settings-flip-to-moderated')).toBeTruthy();
    expect(screen.queryByTestId('settings-flip-to-open')).toBeNull();
  });

  it('hides the flip-to-moderated button (not just disables it) when the feature is unavailable', async () => {
    moderatedAvailable.value = false;
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent }
    });
    expect(await screen.findByTestId('settings-type-card')).toBeTruthy();
    expect(screen.queryByTestId('settings-flip-to-moderated')).toBeNull();
  });

  it('shows no Typ card for a non-owner', async () => {
    render(SettingsView, {
      props: {
        communityId: STRANGER,
        communikeyEvent: communikeyEvent([], STRANGER),
        profileEvent
      }
    });
    await screen.findByText('Community Settings'); // page rendered past the spinner
    expect(screen.queryByTestId('settings-type-card')).toBeNull();
  });

  it('flip-to-open: confirm publishes a template whose tags derive back to open', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: moderatedEvent, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('settings-flip-to-open'));
    await fireEvent.click(await screen.findByTestId('settings-flip-confirm'));
    await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalledOnce());
    const [template] = /** @type {any[]} */ (publishCommunityUpdate.mock.calls[0]);
    expect(deriveCommunityType(template)).toBe('open');
    expect(toastSpy).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('teardown: button shows in the danger zone for a moderated community, hidden for open', async () => {
    const { unmount } = render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: moderatedEvent, profileEvent }
    });
    expect(await screen.findByTestId('settings-teardown')).toBeTruthy();
    unmount();
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent }
    });
    await screen.findByTestId('settings-flip-to-moderated'); // owner pane mounted
    expect(screen.queryByTestId('settings-teardown')).toBeNull();
  });

  it('teardown: the typed-name gate blocks the destructive confirm until the name matches', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: moderatedEvent, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('settings-teardown'));
    const confirm = /** @type {HTMLButtonElement} */ (
      await screen.findByTestId('settings-teardown-confirm')
    );
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByTestId('settings-teardown-input'), {
      target: { value: 'wrong' }
    });
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByTestId('settings-teardown-input'), {
      target: { value: 'Test Community' } // == getDisplayName(profileEvent)
    });
    expect(confirm.disabled).toBe(false);
  });

  it('teardown: confirming deletes the groups + reverts via teardownCommunityGroups', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: moderatedEvent, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('settings-teardown'));
    await fireEvent.input(await screen.findByTestId('settings-teardown-input'), {
      target: { value: 'Test Community' }
    });
    await fireEvent.click(await screen.findByTestId('settings-teardown-confirm'));
    await waitFor(() => expect(teardownCommunityGroups).toHaveBeenCalledOnce());
    const [arg] = /** @type {any[]} */ (teardownCommunityGroups.mock.calls[0]);
    expect(arg.communikeyEvent).toBe(moderatedEvent);
    expect(arg.communitySigner).toBeTruthy(); // owner signs the 10222
    expect(arg.user.pubkey).toBe(OWNER); // human signs the 9008s
    expect(toastSpy).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('flip-to-moderated: confirm provisions the root group, writes then clears the marker, then publishes', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('settings-flip-to-moderated'));
    await fireEvent.click(await screen.findByTestId('settings-flip-confirm'));
    await waitFor(() => expect(publishCommunityUpdate).toHaveBeenCalledOnce());
    expect(provisionRootGroup).toHaveBeenCalledOnce();
    expect(writeRootGroupMarker).toHaveBeenCalledWith(OWNER, 'newroot');
    expect(clearRootGroupMarker).toHaveBeenCalledWith(OWNER);
    const [template] = /** @type {any[]} */ (publishCommunityUpdate.mock.calls[0]);
    expect(deriveCommunityType(template)).toBe('moderated');
  });

  it('flip-to-moderated: seeds the root group with the community picture + about from its kind-0', async () => {
    const richProfile = {
      kind: 0,
      pubkey: OWNER,
      tags: [],
      content: JSON.stringify({
        name: 'Test Community',
        about: 'Building for better education',
        picture: 'https://i.nostr.build/pic.jpg'
      })
    };
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent: richProfile }
    });
    await fireEvent.click(await screen.findByTestId('settings-flip-to-moderated'));
    await fireEvent.click(await screen.findByTestId('settings-flip-confirm'));
    await waitFor(() => expect(provisionRootGroup).toHaveBeenCalledOnce());
    expect(provisionRootGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        about: 'Building for better education',
        picture: 'https://i.nostr.build/pic.jpg'
      })
    );
  });

  it('flip-to-moderated: provisioning failure shows a toast and never publishes', async () => {
    provisionRootGroup.mockRejectedValueOnce(new Error('relay unreachable'));
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('settings-flip-to-moderated'));
    await fireEvent.click(await screen.findByTestId('settings-flip-confirm'));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('relay unreachable'), 'error')
    );
    expect(publishCommunityUpdate).not.toHaveBeenCalled();
    expect(clearRootGroupMarker).not.toHaveBeenCalled();
  });

  it('flip-to-moderated: a whitelist rejection shows the friendly relay-membership message, not the raw reason', async () => {
    provisionRootGroup.mockRejectedValueOnce(
      new Error('restricted: only members of this relay can create a group')
    );
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('settings-flip-to-moderated'));
    await fireEvent.click(await screen.findByTestId('settings-flip-confirm'));
    const m = await import('$lib/paraglide/messages');
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(m.community_groups_relay_membership_required(), 'error')
    );
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('only members of this relay'),
      'error'
    );
    expect(publishCommunityUpdate).not.toHaveBeenCalled();
  });

  it('disables flip-to-moderated with a hint when there is no active account', async () => {
    mockManager.active = null;
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: openEvent, profileEvent }
    });
    const button = /** @type {HTMLButtonElement} */ (
      await screen.findByTestId('settings-flip-to-moderated')
    );
    expect(button.disabled).toBe(true);
    mockManager.active = { pubkey: OWNER, signer: { sign: () => {} } };
  });

  it('cancelling a flip dialog resets the overlay without publishing', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: moderatedEvent, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('settings-flip-to-open'));
    const confirm = await screen.findByTestId('settings-flip-confirm');
    expect(confirm).toBeTruthy();
    await fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('settings-flip-confirm')).toBeNull();
    expect(publishCommunityUpdate).not.toHaveBeenCalled();
  });
});

describe('SettingsView — MembershipPane mount gate (Task 3: approvals reachability)', () => {
  it('mounts MembershipPane for a signed-in non-owner 39001 admin on a moderated community', async () => {
    // activeUser (OWNER) holds no key for this community (owned by
    // STRANGER) but is seated as a root-group admin — the old
    // `isOwner && moderated` gate would have hidden the pane entirely.
    rosterFixture.value = {
      ...rosterFixture.value,
      admins: [{ pubkey: OWNER, roles: ['admin'] }]
    };
    render(SettingsView, {
      props: { communityId: STRANGER, communikeyEvent: moderatedStrangerEvent, profileEvent }
    });
    expect(await screen.findByTestId('membership-pane')).toBeTruthy();
    expect(screen.getByTestId('membership-manage-members')).toBeTruthy();
    // Owner-only cards (community key required) stay hidden.
    expect(screen.queryByTestId('settings-type-card')).toBeNull();
    expect(screen.queryByTestId('access-tier-editor')).toBeNull();
  });

  it('renders no MembershipPane content for a signed-in stranger (not a roster admin, not the owner)', async () => {
    render(SettingsView, {
      props: { communityId: STRANGER, communikeyEvent: moderatedStrangerEvent, profileEvent }
    });
    await screen.findByText('Community Settings'); // page rendered past the spinner
    expect(screen.queryByTestId('membership-pane')).toBeNull();
  });

  it('mounts MembershipPane (roster + invite code, no form card) for the key-holding owner', async () => {
    render(SettingsView, {
      props: { communityId: OWNER, communikeyEvent: moderatedEvent, profileEvent }
    });
    expect(await screen.findByTestId('membership-pane')).toBeTruthy();
    expect(screen.getByTestId('membership-invite-create')).toBeTruthy();
    // The Beitrittsformular card is gone with the application-form layer.
    expect(screen.queryByTestId('membership-application-select')).toBeNull();
  });
});
