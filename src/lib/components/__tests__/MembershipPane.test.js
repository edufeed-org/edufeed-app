/** @vitest-environment jsdom */
/**
 * MembershipPane — Task 8. Root-group roster management (counts + a
 * "Mitglieder verwalten" button wired to GroupMembersModal via the roster
 * hook) and invite-code minting. The application-form layer was removed as
 * YAGNI (laoc, 2026-08-18) — a legacy `application` tag on the 10222 must
 * render NOTHING here. useRootRoster/GroupMembersModal internals are
 * covered by their own suites; this only proves the wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const ADMIN2 = 'b'.repeat(64);
const MEMBER = 'c'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';
const COMMUNIKEY_RELAY = 'wss://communikey.example/';

// vi.mock factories are hoisted above these consts, so anything a factory
// closes over must be built via vi.hoisted() (TDZ, same as
// GroupMembersModal.test.js's header comment explains).
const {
  rosterFixture,
  activeUserFixture,
  communitySigner,
  isCommunityOwner,
  getCommunitySigner,
  showToast,
  publishToGroupRelay
} = vi.hoisted(() => {
  const OWNER = 'a'.repeat(64);
  const ADMIN2 = 'b'.repeat(64);
  const MEMBER = 'c'.repeat(64);
  const GROUPS_RELAY = 'wss://groups.example/';
  return {
    rosterFixture: /** @type {{ value: any }} */ ({
      value: {
        pointer: { id: 'root1', relay: GROUPS_RELAY },
        refresh: vi.fn(),
        admins: [
          { pubkey: OWNER, roles: ['admin'] },
          { pubkey: ADMIN2, roles: ['lehrkraft'] }
        ],
        members: new Set([OWNER, ADMIN2, MEMBER]),
        isLoading: false,
        isMember: () => true,
        rolesOf: () => []
      }
    }),
    activeUserFixture: /** @type {{ value: any }} */ ({ value: { pubkey: OWNER, signer: {} } }),
    communitySigner: { signEvent: vi.fn(async (t) => ({ ...t, id: 'sig', pubkey: OWNER })) },
    isCommunityOwner: vi.fn(() => true),
    getCommunitySigner: vi.fn(() => communitySigner),
    showToast: vi.fn(),
    publishToGroupRelay: vi.fn(async () => ({}))
  };
});

const { putUserOn, fanOut, channelRostersState } = vi.hoisted(() => ({
  putUserOn: vi.fn(async (/** @type {any} */ _p, /** @type {string} */ _pk) => ({})),
  // Real aggregate shape; every item "succeeds" so the pane stays quiet.
  fanOut: vi.fn(
    async (/** @type {any[]} */ items, /** @type {any} */ keyOf, /** @type {any} */ action) => {
      for (const item of items) await action(item);
      return { ok: items.map((/** @type {any} */ i) => keyOf(i)), failed: [] };
    }
  ),
  channelRostersState: {
    membersByKey: /** @type {any} */ ({}),
    adminsByKey: /** @type {any} */ ({})
  }
}));
vi.mock('$lib/groups/roster-fanout.js', () => ({ putUserOn, fanOut }));
vi.mock('$lib/groups/channel-rosters.svelte.js', () => ({
  useChannelRosters: () => () => channelRostersState
}));

const { poolMock, relayRequestEvents } = vi.hoisted(() => {
  /** 9021 fixtures the fake relay serves to the join-request REQ. */
  const relayRequestEvents = { value: /** @type {any[]} */ ([]) };
  return {
    relayRequestEvents,
    poolMock: {
      relay: vi.fn((_url) => ({
        publish: vi.fn(async () => ({ ok: true })),
        request: vi.fn(() => ({
          subscribe: (/** @type {any} */ observer) => {
            for (const event of relayRequestEvents.value) observer.next?.(event);
            observer.complete?.();
            return { unsubscribe: () => {} };
          }
        }))
      }))
    }
  };
});

vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => rosterFixture.value
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => activeUserFixture.value
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: poolMock,
  // ProfileAvatar (join-request rows) imports eventStore statically.
  eventStore: {
    model: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) })),
    profile: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
  }
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: function Stub() {} }));
vi.mock('$lib/helpers/community-signer.js', () => ({ getCommunitySigner, isCommunityOwner }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('$lib/groups/group-management.js', async () => {
  const actual = await vi.importActual('$lib/groups/group-management.js');
  return {
    ...actual,
    publishToGroupRelay
  };
});
vi.mock(
  '$lib/components/groups/GroupMembersModal.svelte',
  () => import('./fixtures/GroupMembersModalStub.svelte')
);
vi.mock('$lib/paraglide/messages', () => ({
  community_membership_pane_title: () => 'Mitglieder & Rollen',
  community_membership_pane_manage: () => 'Mitglieder verwalten',
  community_membership_pane_member_count: (/** @type {{count: number}} */ p) =>
    `${p.count} Mitglieder`,
  community_invite_title: () => 'Einladungscode',
  community_invite_create: () => 'Code erstellen',
  community_invite_hint: () =>
    'Der Code kann auf der Community-Seite unter „Einladungscode einlösen" verwendet werden.',
  community_invite_copy: () => 'Kopieren',
  community_invite_copied: () => 'Kopiert.',
  community_invite_failed: (/** @type {{reason: string}} */ p) =>
    `Code konnte nicht erstellt werden: ${p.reason}`,
  community_invite_clipboard_unavailable: () => 'Zwischenablage nicht verfügbar',
  community_join_requests_title: () => 'Beitrittsanfragen',
  community_join_requests_lead: () => 'lead',
  community_join_requests_approve: () => 'Aufnehmen',
  community_join_requests_ignore: () => 'Ignorieren',
  community_join_request_approved: () => 'Aufgenommen.',
  community_join_request_approve_failed: (/** @type {{reason: string}} */ p) =>
    `Aufnahme fehlgeschlagen: ${p.reason}`
}));

const { default: MembershipPane } = await import(
  '$lib/components/community/settings/MembershipPane.svelte'
);

// id/sig present so applesauce's getDisplayName treats this as a real event
// (it gates event-vs-plain-metadata detection on those two fields).
const profileEvent = {
  kind: 0,
  pubkey: OWNER,
  tags: [],
  content: JSON.stringify({ name: 'X' }),
  id: 'profile-id',
  sig: 'profile-sig'
};

/** @param {string[][]} tags */
function communikeyEvent(tags) {
  return { kind: 10222, pubkey: OWNER, created_at: 1000, content: 'desc', tags };
}

const eventWithApplication = communikeyEvent([
  ['membership', 'root1', GROUPS_RELAY],
  ['application', '30168:' + OWNER + ':membership', COMMUNIKEY_RELAY]
]);
const eventWithoutApplication = communikeyEvent([['membership', 'root1', GROUPS_RELAY]]);

beforeEach(() => {
  rosterFixture.value = {
    pointer: { id: 'root1', relay: GROUPS_RELAY },
    refresh: vi.fn(),
    admins: [
      { pubkey: OWNER, roles: ['admin'] },
      { pubkey: ADMIN2, roles: ['lehrkraft'] }
    ],
    members: new Set([OWNER, ADMIN2, MEMBER]),
    isLoading: false,
    isMember: () => true,
    rolesOf: () => []
  };
  activeUserFixture.value = { pubkey: OWNER, signer: {} };
  isCommunityOwner.mockClear().mockReturnValue(true);
  showToast.mockClear();
  publishToGroupRelay.mockClear();
  putUserOn.mockClear();
  fanOut.mockClear();
  channelRostersState.membersByKey = {};
  channelRostersState.adminsByKey = {};
  relayRequestEvents.value = [];
  localStorage.clear();
  // jsdom has no navigator.clipboard; stub it
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
  });
});

describe('MembershipPane — roster', () => {
  it('renders the member count and opens GroupMembersModal with roster-derived props', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    expect(screen.getByTestId('membership-pane')).toBeTruthy();
    expect(screen.getByText('3 Mitglieder')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('membership-manage-members'));

    const stub = await screen.findByTestId('stub-group-members-modal');
    expect(JSON.parse(/** @type {string} */ (stub.dataset.pointer))).toEqual({
      id: 'root1',
      relay: GROUPS_RELAY
    });
    expect(JSON.parse(/** @type {string} */ (stub.dataset.admins))).toEqual([
      { pubkey: OWNER, roles: ['admin'] },
      { pubkey: ADMIN2, roles: ['lehrkraft'] }
    ]);
    expect(JSON.parse(/** @type {string} */ (stub.dataset.members)).sort()).toEqual(
      [OWNER, ADMIN2, MEMBER].sort()
    );
    expect(stub.dataset.mypubkey).toBe(OWNER);
    expect(stub.dataset.isadmin).toBe('true');
    // Union of admin roles + 'admin', deduped.
    expect(JSON.parse(/** @type {string} */ (stub.dataset.roleoptions)).sort()).toEqual(
      ['admin', 'lehrkraft'].sort()
    );
  });

  it('manage-members button is disabled when the roster has no pointer', () => {
    rosterFixture.value = { ...rosterFixture.value, pointer: null };
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });
    const button = /** @type {HTMLButtonElement} */ (
      screen.getByTestId('membership-manage-members')
    );
    expect(button.disabled).toBe(true);
  });

  it('reports the role union upward via onRolesChanged', async () => {
    const onRolesChanged = vi.fn();
    render(MembershipPane, {
      props: {
        communikeyEvent: eventWithoutApplication,
        communityId: OWNER,
        profileEvent,
        onRolesChanged
      }
    });
    await waitFor(() =>
      expect(onRolesChanged).toHaveBeenCalledWith(expect.arrayContaining(['admin', 'lehrkraft']))
    );
  });
});

// Task 3: the pane's own isAdmin gate — roster admins ∪ the key-holding
// owner — no longer relies on SettingsView passing an owner-only mount
// condition. These lock in the tiers: stranger (nothing), non-owner 39001
// admin and key-holding owner (roster management + invite code).
describe('MembershipPane — access gating', () => {
  it('renders nothing for a signed-in user who is neither a roster admin nor the owner', () => {
    isCommunityOwner.mockReturnValue(false);
    activeUserFixture.value = { pubkey: MEMBER, signer: {} };
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });
    expect(screen.queryByTestId('membership-pane')).toBeNull();
    expect(screen.queryByTestId('membership-manage-members')).toBeNull();
  });

  it('shows roster management for a non-owner 39001 admin', () => {
    isCommunityOwner.mockReturnValue(false);
    activeUserFixture.value = { pubkey: ADMIN2, signer: {} };
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });

    expect(screen.getByTestId('membership-pane')).toBeTruthy();
    expect(screen.getByTestId('membership-manage-members')).toBeTruthy();
  });

  it('shows roster management + invite code for the key-holding owner', () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    expect(screen.getByTestId('membership-pane')).toBeTruthy();
    expect(screen.getByTestId('membership-manage-members')).toBeTruthy();
    expect(screen.getByTestId('membership-invite-create')).toBeTruthy();
  });

  // The removed Beitrittsformular layer: a legacy `application` tag on the
  // 10222 must not resurrect any form UI or approvals queue.
  it('renders no application-form UI even when a legacy application tag exists', () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithApplication, communityId: OWNER, profileEvent }
    });
    expect(screen.queryByTestId('membership-application-select')).toBeNull();
    expect(screen.queryByTestId('membership-application-create-default')).toBeNull();
    expect(screen.queryByTestId('stub-application-approvals')).toBeNull();
  });
});

describe('MembershipPane — member-add fan-out', () => {
  const GROUPS_RELAY_N = 'wss://groups.example/';
  const NEW_MEMBER = 'f'.repeat(64);

  // Adding a member to the ROOT group must also put them on the community's
  // members-tier channels — separate NIP-29 groups whose rosters the relay
  // checks independently (laoc, 2026-08-19: an invited user stood before a
  // locked 'willkommen').
  it('fans a freshly added member out to answered members-tier channel rosters', async () => {
    const eventWithChannel = communikeyEvent([
      ['membership', 'root1', GROUPS_RELAY],
      ['group', 'chan1', GROUPS_RELAY, 'Willkommen', 'members']
    ]);
    channelRostersState.membersByKey = { [`chan1@${GROUPS_RELAY_N}`]: new Set() };
    render(MembershipPane, {
      props: { communikeyEvent: eventWithChannel, communityId: OWNER, profileEvent }
    });
    await fireEvent.click(screen.getByTestId('membership-manage-members'));
    await fireEvent.click(screen.getByTestId('stub-group-members-added'));
    await waitFor(() => expect(putUserOn).toHaveBeenCalledTimes(1));
    expect(putUserOn.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: 'chan1', relay: GROUPS_RELAY })
    );
    expect(putUserOn.mock.calls[0][1]).toBe(NEW_MEMBER);
  });

  it('skips channels whose roster has not answered (the reconcile sweeps later)', async () => {
    const eventWithChannel = communikeyEvent([
      ['membership', 'root1', GROUPS_RELAY],
      ['group', 'chan1', GROUPS_RELAY, 'Willkommen', 'members']
    ]);
    channelRostersState.membersByKey = {};
    render(MembershipPane, {
      props: { communikeyEvent: eventWithChannel, communityId: OWNER, profileEvent }
    });
    await fireEvent.click(screen.getByTestId('membership-manage-members'));
    await fireEvent.click(screen.getByTestId('stub-group-members-added'));
    await new Promise((r) => setTimeout(r, 20));
    expect(putUserOn).not.toHaveBeenCalled();
  });
});

describe('MembershipPane — Beitrittsanfragen (NIP-29 join requests)', () => {
  const APPLICANT = 'e'.repeat(64);
  const req = (
    /** @type {string} */ pubkey,
    /** @type {number} */ at,
    id = `${pubkey.slice(0, 4)}-${at}`
  ) => ({
    id,
    kind: 9021,
    pubkey,
    created_at: at,
    content: 'Ich möchte mitmachen',
    tags: [['h', 'root1']]
  });

  it('lists a stored 9021 from a non-member, hides one from an existing member', async () => {
    relayRequestEvents.value = [req(APPLICANT, 100), req(MEMBER, 200)];
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });
    const rows = await screen.findAllByTestId('join-request-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-pubkey')).toBe(APPLICANT);
  });

  it('approve put-users the applicant on the ROOT group and fans out to member channels', async () => {
    relayRequestEvents.value = [req(APPLICANT, 100)];
    channelRostersState.membersByKey = { [`chan1@wss://groups.example/`]: new Set() };
    render(MembershipPane, {
      props: {
        communikeyEvent: communikeyEvent([
          ['membership', 'root1', GROUPS_RELAY],
          ['group', 'chan1', GROUPS_RELAY, 'Willkommen', 'members']
        ]),
        communityId: OWNER,
        profileEvent
      }
    });
    await fireEvent.click(await screen.findByTestId('join-request-approve'));
    await waitFor(() => expect(putUserOn).toHaveBeenCalledTimes(2));
    // Root first, then the members-tier channel fan-out.
    expect(putUserOn.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'root1' }));
    expect(putUserOn.mock.calls[0][1]).toBe(APPLICANT);
    expect(putUserOn.mock.calls[1][0]).toEqual(expect.objectContaining({ id: 'chan1' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Aufgenommen.', 'success'));
  });

  it('ignore hides the request and persists across a remount', async () => {
    relayRequestEvents.value = [req(APPLICANT, 100)];
    const first = render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });
    await fireEvent.click(await screen.findByTestId('join-request-ignore'));
    expect(screen.queryByTestId('join-request-row')).toBeNull();
    first.unmount();

    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('join-request-row')).toBeNull();
  });
});

describe('MembershipPane — invite-code minting', () => {
  it('renders the invite-code block for admins', () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    expect(screen.getByTestId('membership-invite-create')).toBeTruthy();
  });

  it('clicking create generates a code, publishes 9009 to the roster relay, and displays the code', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledOnce());
    const [relayConn, template, user] = /** @type {any[]} */ (publishToGroupRelay.mock.calls[0]);

    // Verify the relay connection points to the roster relay
    expect(relayConn).toBeTruthy();
    expect(poolMock.relay).toHaveBeenCalledWith(GROUPS_RELAY);

    // Verify the template is kind 9009 with h-tag and code tag
    expect(template.kind).toBe(9009);
    expect(template.tags).toEqual([
      ['h', 'root1'],
      [
        'code',
        expect.stringMatching(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz]{12}$/)
      ]
    ]);

    // Verify user is the active user
    expect(user.pubkey).toBe(OWNER);

    // Verify the code is displayed
    const codeElement = await screen.findByTestId('membership-invite-code');
    expect(codeElement).toBeTruthy();
  });

  it('displays a copy button for the generated code', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() => {
      const copyButton = screen.getByTestId('membership-invite-copy');
      expect(copyButton).toBeTruthy();
    });
  });

  it('copy button shows success toast', async () => {
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() => {
      const copyButton = screen.getByTestId('membership-invite-copy');
      expect(copyButton).toBeTruthy();
    });

    const copyButton = screen.getByTestId('membership-invite-copy');
    await fireEvent.click(copyButton);

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Kopiert'), 'success')
    );
  });

  it('copy button shows an i18n clipboard-unavailable reason, not a hardcoded string', async () => {
    // @ts-expect-error - simulating a browser with no Clipboard API
    delete navigator.clipboard;
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));
    await waitFor(() => expect(screen.getByTestId('membership-invite-copy')).toBeTruthy());

    await fireEvent.click(screen.getByTestId('membership-invite-copy'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('Zwischenablage nicht verfügbar'),
        'error'
      )
    );
  });

  it('shows an error toast when publishing fails', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('relay rejected'));
    render(MembershipPane, {
      props: { communikeyEvent: eventWithoutApplication, communityId: OWNER, profileEvent }
    });

    await fireEvent.click(screen.getByTestId('membership-invite-create'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('relay rejected'), 'error')
    );
  });
});
