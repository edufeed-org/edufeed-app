/**
 * MembersView — Plan 5 Task 11: moderated-community role chips.
 *
 * For MODERATED communities (membership pointer tag), member rows show role
 * chips sourced from the root-group NIP-29 roster (`useRootRoster`'s
 * `admins` list — public, so visible even to visitors). Bare admins (empty
 * `roles`) fall back to a single 'admin' chip. Open communities (no
 * membership pointer) render exactly as before — no chips at all, even if
 * the (unused) roster happens to carry admin data.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  community_members_title: () => 'Members',
  community_members_loading: () => 'Loading members...',
  community_members_open_community: () => 'This is an open community.',
  community_members_moderated_community: () => 'This is a moderated community.',
  community_members_owner_badge: () => 'Owner',
  community_members_count: (/** @type {{count: number}} */ { count }) => `${count} members`,
  community_members_count_one: () => '1 member',
  community_members_all_sections: () => 'All content sections',
  community_members_search_placeholder: () => 'Search members',
  community_members_search_empty: () => 'No members match.',
  community_members_add_title: () => 'Add member',
  groups_role_admin: () => 'Admin',
  groups_role_king: () => 'Founder',
  groups_role_moderator: () => 'Moderator',
  groups_role_publisher: () => 'Publisher',
  groups_members_promote: () => 'Make admin',
  groups_members_demote: () => 'Remove admin',
  groups_members_remove: () => 'Remove',
  groups_members_grant_publisher: () => 'Make publisher',
  groups_members_revoke_publisher: () => 'Remove publisher',
  groups_members_assign_role: () => 'Assign role',
  groups_members_assign_role_open: () => 'Assign role …',
  groups_members_assign_role_title: () => 'Assign role',
  groups_members_assign_role_body: (/** @type {{name: string}} */ { name }) =>
    `New role for ${name}.`,
  groups_members_remove_confirm_title: (/** @type {{name: string}} */ { name }) =>
    `Remove ${name}?`,
  groups_members_remove_confirm_body: (/** @type {{name: string}} */ { name }) =>
    `${name} loses access to this group.`,
  groups_members_row_menu: (/** @type {{name: string}} */ { name }) => `Actions for ${name}`,
  groups_members_role_placeholder: () => 'Role',
  groups_members_action_failed: () => 'The relay refused the change',
  common_cancel: () => 'Cancel',
  community_members_area_note: () => 'Area members are private.',
  community_members_area_chip: () => 'Private area',
  community_membership_pane_manage: () => 'Manage members',
  concord_role_owner: () => 'Owner',
  concord_role_admin: () => 'Admin',
  concord_role_moderator: () => 'Moderator'
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => holders.profileMap
}));

// MemberActionsMenu renders for real (its publish path is what the inline
// consolidation is about), so its relay-facing deps are mocked like in
// GroupMembersModal.test.js.
vi.mock('$lib/groups/group-management.js', () => ({
  buildPutUserTemplate: mgmtMocks.buildPutUserTemplate,
  buildRemoveUserTemplate: mgmtMocks.buildRemoveUserTemplate,
  publishToGroupRelay: mgmtMocks.publishToGroupRelay
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: () => ({}) }
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/components/groups/AddMemberControl.svelte', () => ({
  default: function Stub() {}
}));

vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordCommunity: () => () => ({ community: holders.areaCommunity, ...holders.areaCaps })
}));
vi.mock('$lib/concord/bridge.svelte.js', () => ({
  // Mirrors the real hook's contract: a getter returning the observable's
  // latest value. Fixture "observables" are plain `{ __value }` markers on
  // the fake area community (members$/roles$/grants$).
  useObservable: (/** @type {any} */ getObservable, /** @type {any} */ initial) => () => {
    let obs;
    try {
      obs = getObservable();
    } catch {
      obs = undefined;
    }
    return obs && typeof obs === 'object' && '__value' in obs ? obs.__value : initial;
  }
}));

vi.mock('$lib/components/shared/ProfileCard.svelte', () => ({
  default: function Stub() {}
}));

// Stubbed: both pull heavy relay/group dep trees, and their own behavior is
// covered by MembershipPane.test.js / GroupMembersModal.test.js.
vi.mock('$lib/components/community/settings/JoinRequestsPanel.svelte', () => ({
  default: function Stub() {}
}));
vi.mock('$lib/components/groups/GroupMembersModal.svelte', () => ({
  default: function Stub() {}
}));
vi.mock('$lib/components/community/channels/ChannelMembersModal.svelte', () => ({
  default: function Stub() {}
}));

// Signed-in viewer is configurable per test (default: signed out), with the
// manager/accountsMeta shape community-signer.js reaches for.
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => (holders.activePubkey ? { pubkey: holders.activePubkey } : null),
  manager: { getAccountForPubkey: () => undefined },
  accountsMeta: { version: 0 }
}));

const mgmtMocks = vi.hoisted(() => ({
  buildPutUserTemplate: vi.fn(
    (
      /** @type {string} */ groupId,
      /** @type {string} */ pubkey,
      /** @type {string[]} */ roles
    ) => ({
      groupId,
      pubkey,
      roles
    })
  ),
  buildRemoveUserTemplate: vi.fn((/** @type {string} */ groupId, /** @type {string} */ pubkey) => ({
    groupId,
    pubkey
  })),
  publishToGroupRelay: vi.fn(() => Promise.resolve({ id: 'signed' }))
}));

const holders = vi.hoisted(() => ({
  /** @type {{ isLoading: boolean, getMembers: (name: string) => string[] }} */
  profileAccess: { isLoading: false, getMembers: () => [] },
  /** @type {Map<string, any>} */
  profileMap: new Map(),
  /** @type {{pubkey: string, roles: string[]}[]} */
  admins: /** @type {{pubkey: string, roles: string[]}[]} */ ([]),
  /** @type {any} */
  areaCommunity: null,
  /** @type {Record<string, any>} */
  areaCaps: {},
  /** @type {Set<string>} */
  members: new Set(),
  /** @type {{id: string, relay: string} | null} */
  pointer: null,
  /** @type {string | null} */
  activePubkey: null
}));

vi.mock('svelte', async (importOriginal) => {
  const actual = /** @type {Record<string, any>} */ (await importOriginal());
  return {
    ...actual,
    getContext: (/** @type {string} */ key) =>
      key === 'profileAccess' ? holders.profileAccess : undefined
  };
});

vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => ({
    pointer: holders.pointer,
    refresh: vi.fn(),
    members: holders.members,
    admins: holders.admins,
    isLoading: false,
    isMember: () => false,
    rolesOf: (/** @type {string} */ pk) => holders.admins.find((a) => a.pubkey === pk)?.roles ?? []
  })
}));

import MembersView from '$lib/components/community/views/MembersView.svelte';
import { ADMIN_PERMS, MOD_PERMS } from '$lib/concord/roles.js';

const OWNER = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);
const REGULAR = 'c'.repeat(64);

const OPEN_EVENT = { pubkey: OWNER, kind: 10222, tags: [] };
const MODERATED_EVENT_OWNER_ONLY = {
  pubkey: OWNER,
  kind: 10222,
  tags: [['membership', 'root123', 'wss://groups.example']]
};
const MODERATED_EVENT_WITH_SECTION = {
  pubkey: OWNER,
  kind: 10222,
  tags: [
    ['membership', 'root123', 'wss://groups.example'],
    ['content', 'General'],
    ['access', 'members']
  ]
};

beforeEach(() => {
  holders.profileAccess = { isLoading: false, getMembers: () => [] };
  holders.profileMap = new Map();
  holders.admins = [];
  holders.areaCommunity = null;
  holders.areaCaps = {};
  holders.members = new Set();
  holders.pointer = null;
  holders.activePubkey = null;
});

describe('MembersView — open community (unchanged)', () => {
  it('renders no role chips, even when a roster happens to carry admin data', () => {
    holders.admins = [{ pubkey: OWNER, roles: ['admin'] }];
    render(MembersView, { props: { communikeyEvent: OPEN_EVENT } });
    expect(screen.queryAllByTestId('member-role-chip')).toHaveLength(0);
    expect(screen.getByText('Owner')).toBeTruthy();
  });
});

describe('MembersView — moderated community', () => {
  // The ROOT roster IS the membership — it must be listed even when no
  // content section is gated, and the banner must not claim "open community"
  // (laoc, 2026-08-19: an all-"Alle" moderated community showed only the
  // owner and "jeder kann beitragen").
  it('lists root-roster members without gated sections, with the moderated banner', () => {
    holders.admins = [{ pubkey: OWNER, roles: [] }];
    holders.members = new Set([OWNER, ADMIN, REGULAR]);
    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });
    expect(screen.queryByText('This is an open community.')).toBeNull();
    const cards = screen.getAllByTestId('member-row');
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  it('shows an admin chip on the owner-only branch for a bare (roles=[]) admin', () => {
    holders.admins = [{ pubkey: OWNER, roles: [] }];
    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });
    const chips = screen.getAllByTestId('member-role-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent?.trim()).toBe('Admin');
  });

  it('shows the roster role on the matching member row, and no chip for non-roster members', () => {
    holders.profileAccess = {
      isLoading: false,
      getMembers: (name) => (name === 'General' ? [ADMIN, REGULAR] : [])
    };
    holders.admins = [{ pubkey: ADMIN, roles: ['admin'] }];

    const { container } = render(MembersView, {
      props: { communikeyEvent: MODERATED_EVENT_WITH_SECTION }
    });

    const adminRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${ADMIN}"]`)
    );
    expect(within(adminRow).getByTestId('member-role-chip').textContent?.trim()).toBe('Admin');

    const regularRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${REGULAR}"]`)
    );
    expect(within(regularRow).queryByTestId('member-role-chip')).toBeNull();
  });

  it('collapses section chips to one "all sections" chip when a member is in every gated section', () => {
    // A roster member of a fully members-gated community is in EVERY section;
    // eight identical chips per row sprawled across the layout (laoc
    // 2026-08-14 screenshot). One collapsed chip carries the same information.
    const EVENT = {
      pubkey: OWNER,
      kind: 10222,
      tags: [
        ['membership', 'root123', 'wss://groups.example'],
        ['content', 'General'],
        ['access', 'members'],
        ['content', 'Wiki'],
        ['access', 'members']
      ]
    };
    holders.profileAccess = { isLoading: false, getMembers: () => [ADMIN] };

    const { container } = render(MembersView, { props: { communikeyEvent: EVENT } });

    const adminRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${ADMIN}"]`)
    );
    expect(within(adminRow).getByText('All content sections')).toBeTruthy();
    expect(within(adminRow).queryByText('General')).toBeNull();
    expect(within(adminRow).queryByText('Wiki')).toBeNull();
  });

  it('keeps the named section chip when a member is in only some sections', () => {
    const EVENT = {
      pubkey: OWNER,
      kind: 10222,
      tags: [
        ['membership', 'root123', 'wss://groups.example'],
        ['content', 'General'],
        ['access', 'members'],
        ['content', 'Wiki'],
        ['access', 'members']
      ]
    };
    holders.profileAccess = {
      isLoading: false,
      getMembers: (name) => (name === 'General' ? [ADMIN] : [OWNER])
    };

    const { container } = render(MembersView, { props: { communikeyEvent: EVENT } });

    const adminRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${ADMIN}"]`)
    );
    expect(within(adminRow).getByText('General')).toBeTruthy();
    expect(within(adminRow).queryByText('All content sections')).toBeNull();
  });

  it('a malformed roster with a duplicated role renders one chip, not a crash', () => {
    // Roles come straight off a kind 39001 event's tags — untrusted network
    // input a relay can repeat. A duplicate key in this keyed {#each} would
    // otherwise crash the whole page (each_key_duplicate).
    holders.admins = [{ pubkey: OWNER, roles: ['admin', 'admin', 'reviewer'] }];

    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });

    const chips = screen.getAllByTestId('member-role-chip').map((el) => el.textContent?.trim());
    expect(chips.filter((text) => text === 'Admin')).toHaveLength(1);
    expect(chips).toContain('reviewer');
  });
});

describe('MembersView — community with a linked private area', () => {
  const AREA_EVENT = {
    pubkey: OWNER,
    kind: 10222,
    tags: [
      ['concord', 'c'.repeat(64), 'wss://concord.example'],
      ['content', 'Chat'],
      ['access', 'members']
    ]
  };

  it('merges decrypted area members into the list with the area chip', () => {
    holders.areaCommunity = { members$: { __value: new Set([OWNER, ADMIN]) } };

    const { container } = render(MembersView, { props: { communikeyEvent: AREA_EVENT } });

    const adminRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${ADMIN}"]`)
    );
    expect(adminRow).not.toBeNull();
    expect(within(adminRow).getByTestId('member-area-chip')).toBeTruthy();
    // Count includes area members (owner + admin = 2)
    expect(screen.getByText('2 members')).toBeTruthy();
  });

  it('shows the privacy note (not "open community") when the viewer cannot decrypt the roster', () => {
    holders.areaCommunity = null; // viewer is not an area member
    render(MembersView, { props: { communikeyEvent: AREA_EVENT } });
    expect(screen.getByText('Area members are private.')).toBeTruthy();
    expect(screen.queryByText('This is an open community.')).toBeNull();
  });
});

// Epic follow-up (issues 2+3 of the groups epic): area members' CORD-04 tiers
// were fetched but never rendered here, and role management had no entry
// point outside a channel's own members modal.
describe('MembersView — Concord area roles', () => {
  const AREA_EVENT = {
    pubkey: OWNER,
    kind: 10222,
    tags: [['concord', 'c'.repeat(64), 'wss://concord.example']]
  };

  /** Owner + one preset-admin + one preset-moderator, viewer-decryptable. */
  const roledArea = () => ({
    material: { owner: OWNER },
    members$: { __value: new Set([OWNER, ADMIN, REGULAR]) },
    roles$: {
      __value: [
        { role_id: 'r-admin', permissions: String(ADMIN_PERMS) },
        { role_id: 'r-mod', permissions: String(MOD_PERMS) }
      ]
    },
    grants$: {
      __value: new Map([
        [ADMIN, ['r-admin']],
        [REGULAR, ['r-mod']]
      ])
    }
  });

  it('area members show their tier chips (admin / moderator)', () => {
    holders.areaCommunity = roledArea();
    const { container } = render(MembersView, { props: { communikeyEvent: AREA_EVENT } });
    const chipOf = (/** @type {string} */ pubkey) => {
      const row = /** @type {HTMLElement} */ (
        container.querySelector(`[data-testid="member-row"][data-pubkey="${pubkey}"]`)
      );
      return row ? within(row).queryByTestId('member-area-tier-chip') : null;
    };
    expect(chipOf(ADMIN)?.textContent).toContain('Admin');
    expect(chipOf(REGULAR)?.textContent).toContain('Moderator');
    // The area owner is the community owner here — the Owner badge already
    // marks that row; no duplicate tier chip.
    expect(chipOf(OWNER)).toBeNull();
  });

  it('an actor with role capability gets the area manage button', () => {
    holders.areaCommunity = roledArea();
    holders.areaCaps = {
      canManageRoles: true,
      canPromoteAdmin: false,
      myTier: 'admin',
      signerHasNip44: true
    };
    render(MembersView, { props: { communikeyEvent: AREA_EVENT } });
    expect(screen.getByTestId('members-manage-area-button')).toBeTruthy();
  });

  it('no manage button for a plain area member', () => {
    holders.areaCommunity = roledArea();
    render(MembersView, { props: { communikeyEvent: AREA_EVENT } });
    expect(screen.queryByTestId('members-manage-area-button')).toBeNull();
  });
});

// Consolidation (issue 7ca94a65): the members list itself carries the admin
// actions inline — the separate "Mitglieder verwalten" modal surface on this
// page is gone. Rows of roster members get the same kebab GroupMembersModal
// used; adding members happens in an inline section instead of the modal.
describe('MembersView — inline roster management', () => {
  const asAdmin = () => {
    holders.admins = [{ pubkey: ADMIN, roles: ['admin'] }];
    holders.members = new Set([OWNER, ADMIN, REGULAR]);
    holders.pointer = { id: 'root123', relay: 'wss://groups.example' };
    holders.activePubkey = ADMIN;
  };

  it('the separate manage-members button is gone for admins', () => {
    asAdmin();
    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });
    expect(screen.queryByTestId('members-manage-button')).toBeNull();
  });

  it('an admin sees the action kebab on other roster rows, but not on their own row', () => {
    asAdmin();
    const { container } = render(MembersView, {
      props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY }
    });
    const rowOf = (/** @type {string} */ pubkey) =>
      /** @type {HTMLElement} */ (
        container.querySelector(`[data-testid="member-row"][data-pubkey="${pubkey}"]`)
      );
    expect(within(rowOf(REGULAR)).getByTestId('member-actions-menu')).toBeTruthy();
    expect(within(rowOf(ADMIN)).queryByTestId('member-actions-menu')).toBeNull();
  });

  it('a signed-in non-admin member sees no kebabs and no add section', () => {
    holders.admins = [{ pubkey: ADMIN, roles: ['admin'] }];
    holders.members = new Set([OWNER, ADMIN, REGULAR]);
    holders.pointer = { id: 'root123', relay: 'wss://groups.example' };
    holders.activePubkey = REGULAR;
    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });
    expect(screen.queryAllByTestId('member-actions-menu')).toHaveLength(0);
    expect(screen.queryByTestId('members-add-section')).toBeNull();
  });

  it('a section-only member outside the roster gets no kebab', () => {
    asAdmin();
    holders.profileAccess = {
      isLoading: false,
      getMembers: (name) => (name === 'General' ? ['e'.repeat(64)] : [])
    };
    const { container } = render(MembersView, {
      props: { communikeyEvent: MODERATED_EVENT_WITH_SECTION }
    });
    const strangerRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${'e'.repeat(64)}"]`)
    );
    expect(within(strangerRow).queryByTestId('member-actions-menu')).toBeNull();
  });

  it('an admin sees the inline add-member section, also on the owner-only branch', () => {
    holders.admins = [{ pubkey: ADMIN, roles: ['admin'] }];
    holders.members = new Set([OWNER]);
    holders.pointer = { id: 'root123', relay: 'wss://groups.example' };
    holders.activePubkey = ADMIN;
    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });
    expect(screen.getByTestId('members-add-section')).toBeTruthy();
    expect(screen.getByText('Add member')).toBeTruthy();
  });

  it('promote on a member row publishes a put-user against the root group', async () => {
    asAdmin();
    const { container } = render(MembersView, {
      props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY }
    });
    const regularRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${REGULAR}"]`)
    );
    await fireEvent.click(within(regularRow).getByTestId('member-promote'));
    await waitFor(() => expect(mgmtMocks.publishToGroupRelay).toHaveBeenCalled());
    expect(mgmtMocks.buildPutUserTemplate).toHaveBeenCalledWith('root123', REGULAR, ['admin']);
  });
});

describe('MembersView — member search', () => {
  const setupList = () => {
    holders.admins = [{ pubkey: ADMIN, roles: ['admin'] }];
    holders.members = new Set([OWNER, ADMIN, REGULAR]);
    holders.profileMap = new Map([
      [ADMIN, { name: 'Alice' }],
      [REGULAR, { name: 'Bob' }]
    ]);
  };

  it('filters rows by profile name, case-insensitively', async () => {
    setupList();
    const { container } = render(MembersView, {
      props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY }
    });
    await fireEvent.input(screen.getByTestId('members-search'), { target: { value: 'ali' } });
    expect(
      container.querySelector(`[data-testid="member-row"][data-pubkey="${ADMIN}"]`)
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="member-row"][data-pubkey="${REGULAR}"]`)
    ).toBeNull();
  });

  it('matches on the hex pubkey too', async () => {
    setupList();
    const { container } = render(MembersView, {
      props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY }
    });
    await fireEvent.input(screen.getByTestId('members-search'), { target: { value: 'ccc' } });
    expect(
      container.querySelector(`[data-testid="member-row"][data-pubkey="${REGULAR}"]`)
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="member-row"][data-pubkey="${ADMIN}"]`)
    ).toBeNull();
  });

  it('shows an empty note when nothing matches', async () => {
    setupList();
    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });
    await fireEvent.input(screen.getByTestId('members-search'), { target: { value: 'zzz' } });
    expect(screen.getByText('No members match.')).toBeTruthy();
    expect(screen.queryAllByTestId('member-row')).toHaveLength(0);
  });
});
