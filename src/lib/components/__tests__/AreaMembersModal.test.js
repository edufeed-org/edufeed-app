/** @vitest-environment jsdom */
/**
 * AreaMembersModal — Task 5. Union of a community's Stufe-2 ("members")
 * NIP-29 channels' rosters: flags anyone missing from at least one channel,
 * lets an admin repair a single row (put-user ONLY to the missing
 * channels), remove a row from every channel it's in, or add a new member
 * to every Stufe-2 channel at once. Admin capability is per-channel — action
 * buttons render only when the acting user is admin in at least one TARGET
 * channel of that action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// vi.mock factories are hoisted above these consts, so everything the mock
// factories close over must be built via vi.hoisted() to avoid a "Cannot
// access before initialization" TDZ error at hoist time.
const {
  ADMIN,
  MEMBER_A,
  MEMBER_B,
  RELAY,
  relaySentinel,
  activeUser,
  rosterState,
  refreshMock,
  useChannelRosters,
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  publishToGroupRelay,
  showToast
} = vi.hoisted(() => {
  const ADMIN = 'a'.repeat(64);
  const MEMBER_A = 'c'.repeat(64);
  const MEMBER_B = 'd'.repeat(64);
  const RELAY = 'wss://relay.test/';
  const refreshMock = vi.fn();
  /** Mutated per-test before render(); useChannelRosters snapshots it on every call. */
  const rosterState = { membersByKey: {}, adminsByKey: {} };
  return {
    ADMIN,
    MEMBER_A,
    MEMBER_B,
    RELAY,
    relaySentinel: { __sentinel: 'relay-conn' },
    activeUser: { pubkey: ADMIN, signer: {} },
    rosterState,
    refreshMock,
    useChannelRosters: vi.fn(() => () => ({
      membersByKey: rosterState.membersByKey,
      adminsByKey: rosterState.adminsByKey,
      refresh: refreshMock
    })),
    buildPutUserTemplate: vi.fn((groupId, pubkey, roles) => ({
      __sentinel: 'put',
      groupId,
      pubkey,
      roles
    })),
    buildRemoveUserTemplate: vi.fn((groupId, pubkey) => ({
      __sentinel: 'remove',
      groupId,
      pubkey
    })),
    publishToGroupRelay: vi.fn(
      (/** @type {any} */ _relayConn, /** @type {any} */ _template, /** @type {any} */ _user) =>
        Promise.resolve({ id: 'signed' })
    ),
    showToast: vi.fn()
  };
});

vi.mock('$lib/groups/channel-rosters.svelte.js', () => ({ useChannelRosters }));
vi.mock('$lib/groups/group-management.js', () => ({
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  publishToGroupRelay
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relaySentinel) }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => activeUser }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
function Stub() {}
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/paraglide/messages', () => ({
  area_members_title: () => 'Members of this area',
  area_members_lead: () =>
    "Everyone here is in the community's shared channels. Selected-members channels manage their own lists.",
  area_members_missing: (/** @type {{count: number}} */ { count }) =>
    `missing in ${count} channels`,
  area_members_repair: () => 'Repair',
  area_members_remove: () => 'Remove',
  area_members_sync: () => 'Check members',
  area_members_add_placeholder: () => 'Add member by name or npub',
  area_members_fanout_ok: (/** @type {{count: number}} */ { count }) =>
    `Added to ${count} channels`,
  area_members_fanout_partial: (/** @type {{failed: number, total: number}} */ { failed, total }) =>
    `${failed} of ${total} channels refused — see the badges`,
  area_members_fanout_partial_removed: (
    /** @type {{failed: number, total: number, names: string}} */ { failed, total, names }
  ) => `${failed} of ${total} channels refused to remove — ${names}`,
  area_members_removed: (/** @type {{count: number}} */ { count }) =>
    `Removed from ${count} channels`
}));

const { default: AreaMembersModal } = await import(
  '$lib/components/community/channels/AreaMembersModal.svelte'
);
const { channelKey } = await import('$lib/groups/community-pointer.js');

const KEY_A = /** @type {string} */ (channelKey({ id: 'chan-a', relay: RELAY }));
const KEY_B = /** @type {string} */ (channelKey({ id: 'chan-b', relay: RELAY }));
const KEY_C = /** @type {string} */ (channelKey({ id: 'chan-c', relay: RELAY }));

const communikeyEvent = {
  tags: [
    ['group', 'chan-a', RELAY, 'General', 'members'],
    ['group', 'chan-b', RELAY, 'Announcements', 'members']
  ]
};

const threeChannelEvent = {
  tags: [
    ['group', 'chan-a', RELAY, 'General', 'members'],
    ['group', 'chan-b', RELAY, 'Announcements', 'members'],
    ['group', 'chan-c', RELAY, 'Random', 'members']
  ]
};

/** @param {Record<string, any>} overrides */
function renderModal(overrides = {}) {
  const onClose = vi.fn();
  const props = { communikeyEvent, onClose, ...overrides };
  const result = render(AreaMembersModal, { props });
  return { ...result, onClose };
}

beforeEach(() => {
  rosterState.membersByKey = {};
  rosterState.adminsByKey = {};
  useChannelRosters.mockClear();
  refreshMock.mockClear();
  buildPutUserTemplate.mockClear();
  buildRemoveUserTemplate.mockClear();
  publishToGroupRelay.mockClear();
  publishToGroupRelay.mockResolvedValue({ id: 'signed' });
  showToast.mockClear();
});

describe('AreaMembersModal rendering', () => {
  it('renders the union with a deviation badge on the member missing from one channel', () => {
    rosterState.membersByKey = {
      [KEY_A]: new Set([ADMIN, MEMBER_A, MEMBER_B]),
      [KEY_B]: new Set([ADMIN, MEMBER_A])
    };
    rosterState.adminsByKey = {
      [KEY_A]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_B]: [{ pubkey: ADMIN, roles: ['admin'] }]
    };
    const { container } = renderModal();

    const rows = screen.getAllByTestId('area-member-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.dataset.pubkey)).toEqual([ADMIN, MEMBER_A, MEMBER_B]);

    // MEMBER_B is missing from channel B only.
    const memberBRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="area-member-row"][data-pubkey="${MEMBER_B}"]`)
    );
    const badge = memberBRow.querySelector('[data-testid="area-member-deviation"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('missing in 1 channels');
    expect(badge?.getAttribute('title')).toContain('Announcements');

    // Nobody else carries a deviation badge.
    const adminRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="area-member-row"][data-pubkey="${ADMIN}"]`)
    );
    expect(adminRow.querySelector('[data-testid="area-member-deviation"]')).toBeNull();
  });

  it('non-admin (empty adminsByKey): no add input, no repair/remove buttons', () => {
    rosterState.membersByKey = {
      [KEY_A]: new Set([MEMBER_A]),
      [KEY_B]: new Set([MEMBER_A])
    };
    rosterState.adminsByKey = {}; // acting user (ADMIN) is not admin anywhere
    renderModal();

    expect(screen.queryAllByTestId('area-member-repair')).toHaveLength(0);
    expect(screen.queryAllByTestId('area-member-remove')).toHaveLength(0);
    expect(screen.queryByTestId('stub-select-a')).toBeNull();
    expect(screen.queryByTestId('area-members-sync')).toBeNull();
  });
});

describe('AreaMembersModal repair', () => {
  it('repair fans out put-user ONLY to the missing channels, then refresh fires', async () => {
    rosterState.membersByKey = {
      [KEY_A]: new Set([ADMIN, MEMBER_A, MEMBER_B]),
      [KEY_B]: new Set([ADMIN, MEMBER_A])
    };
    rosterState.adminsByKey = {
      [KEY_A]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_B]: [{ pubkey: ADMIN, roles: ['admin'] }]
    };
    const { container } = renderModal();

    const repairBtn = container.querySelector(
      `[data-testid="area-member-repair"][data-pubkey="${MEMBER_B}"]`
    );
    expect(repairBtn).not.toBeNull();
    await fireEvent.click(/** @type {Element} */ (repairBtn));

    await waitFor(() => expect(buildPutUserTemplate).toHaveBeenCalledWith('chan-b', MEMBER_B, []));
    expect(buildPutUserTemplate).not.toHaveBeenCalledWith('chan-a', MEMBER_B, expect.anything());
    expect(publishToGroupRelay).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Added to 1 channels', 'success'));
  });
});

describe('AreaMembersModal add member', () => {
  it('fans out to every Stufe-2 pointer; a rejected channel produces the partial-warning toast and NO unhandled rejection', async () => {
    rosterState.membersByKey = {
      [KEY_A]: new Set([ADMIN]),
      [KEY_B]: new Set([ADMIN])
    };
    rosterState.adminsByKey = {
      [KEY_A]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_B]: [{ pubkey: ADMIN, roles: ['admin'] }]
    };
    // chan-b always refuses (initial attempt AND the one retry); chan-a
    // always succeeds — proves both are still attempted and neither
    // rejection escapes as an unhandled promise rejection.
    publishToGroupRelay.mockImplementation((_relayConn, template) => {
      if (template.groupId === 'chan-b') return Promise.reject(new Error('relay refused'));
      return Promise.resolve({ id: 'signed' });
    });

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      const { container } = renderModal();

      const addButton = container.querySelector('[data-testid="stub-select-a"]');
      expect(addButton).not.toBeNull();
      await fireEvent.click(/** @type {Element} */ (addButton));

      await waitFor(() => expect(buildPutUserTemplate).toHaveBeenCalledWith('chan-a', ADMIN, []));
      await waitFor(() => expect(buildPutUserTemplate).toHaveBeenCalledWith('chan-b', ADMIN, []));
      // One retry on the failing channel: 1 (chan-a) + 2 (chan-b) = 3.
      await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledTimes(3));

      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith(
          '1 of 2 channels refused — see the badges',
          'warning'
        )
      );
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      // Give any stray rejection a microtask/macrotask to surface.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('AreaMembersModal remove (handoff #11a/#11b)', () => {
  it('removing a row hides its repair prompt even though the deviation data is unchanged (no contradictory repair)', async () => {
    // MEMBER_B is present in chan-a (removeRow's only target) and already
    // missing from chan-b — a pre-existing deviation that would show the
    // repair button under the old rule. This test never mutates rosterState
    // after the click (the mock has no real relay round-trip), so the
    // ONLY thing that can hide the button is the removal itself being
    // remembered — not a refreshed roster.
    rosterState.membersByKey = {
      [KEY_A]: new Set([ADMIN, MEMBER_B]),
      [KEY_B]: new Set([ADMIN])
    };
    rosterState.adminsByKey = {
      [KEY_A]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_B]: [{ pubkey: ADMIN, roles: ['admin'] }]
    };
    const { container } = renderModal();

    // Before removing: the pre-existing deviation offers the (soon to be
    // contradictory) repair prompt.
    expect(
      container.querySelector(`[data-testid="area-member-repair"][data-pubkey="${MEMBER_B}"]`)
    ).not.toBeNull();

    const removeBtn = container.querySelector(
      `[data-testid="area-member-remove"][data-pubkey="${MEMBER_B}"]`
    );
    expect(removeBtn).not.toBeNull();
    await fireEvent.click(/** @type {Element} */ (removeBtn));
    await waitFor(() => expect(buildRemoveUserTemplate).toHaveBeenCalledWith('chan-a', MEMBER_B));

    await waitFor(() =>
      expect(
        container.querySelector(`[data-testid="area-member-repair"][data-pubkey="${MEMBER_B}"]`)
      ).toBeNull()
    );
  });

  it('a rejected removal names the refusing channels in the toast (parity with add, which points at badges instead)', async () => {
    rosterState.membersByKey = {
      [KEY_A]: new Set([ADMIN, MEMBER_A]),
      [KEY_B]: new Set([ADMIN, MEMBER_A])
    };
    rosterState.adminsByKey = {
      [KEY_A]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_B]: [{ pubkey: ADMIN, roles: ['admin'] }]
    };
    // chan-b always refuses the removal (initial attempt AND the retry).
    publishToGroupRelay.mockImplementation((_relayConn, template) => {
      if (template.__sentinel === 'remove' && template.groupId === 'chan-b') {
        return Promise.reject(new Error('relay refused'));
      }
      return Promise.resolve({ id: 'signed' });
    });
    const { container } = renderModal();

    const removeBtn = container.querySelector(
      `[data-testid="area-member-remove"][data-pubkey="${MEMBER_A}"]`
    );
    await fireEvent.click(/** @type {Element} */ (removeBtn));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        '1 of 2 channels refused to remove — Announcements',
        'warning'
      )
    );
  });
});

describe('AreaMembersModal bulk sync', () => {
  it('area-members-sync repairs every deviation in one click: one aggregated toast, one refresh', async () => {
    // MEMBER_A is missing from chan-b only; MEMBER_B is missing from chan-c
    // only — two different rows, each with a different missing channel.
    rosterState.membersByKey = {
      [KEY_A]: new Set([ADMIN, MEMBER_A, MEMBER_B]),
      [KEY_B]: new Set([ADMIN, MEMBER_B]),
      [KEY_C]: new Set([ADMIN, MEMBER_A])
    };
    rosterState.adminsByKey = {
      [KEY_A]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_B]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_C]: [{ pubkey: ADMIN, roles: ['admin'] }]
    };

    renderModal({ communikeyEvent: threeChannelEvent });

    const syncBtn = screen.getByTestId('area-members-sync');
    await fireEvent.click(syncBtn);

    await waitFor(() => expect(buildPutUserTemplate).toHaveBeenCalledWith('chan-b', MEMBER_A, []));
    await waitFor(() => expect(buildPutUserTemplate).toHaveBeenCalledWith('chan-c', MEMBER_B, []));
    // No spurious put-user into a channel a row is already in.
    expect(buildPutUserTemplate).not.toHaveBeenCalledWith('chan-a', MEMBER_A, expect.anything());
    expect(buildPutUserTemplate).not.toHaveBeenCalledWith('chan-a', MEMBER_B, expect.anything());
    expect(publishToGroupRelay).toHaveBeenCalledTimes(2);

    // ONE combined toast (not one per row) and ONE refresh.
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith('Added to 2 channels', 'success');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('hides area-members-sync when nobody has a deviation', () => {
    rosterState.membersByKey = {
      [KEY_A]: new Set([ADMIN, MEMBER_A]),
      [KEY_B]: new Set([ADMIN, MEMBER_A])
    };
    rosterState.adminsByKey = {
      [KEY_A]: [{ pubkey: ADMIN, roles: ['admin'] }],
      [KEY_B]: [{ pubkey: ADMIN, roles: ['admin'] }]
    };

    renderModal();

    expect(screen.queryByTestId('area-members-sync')).toBeNull();
  });
});
