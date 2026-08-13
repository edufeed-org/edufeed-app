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
import { render, screen, within } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  community_members_title: () => 'Members',
  community_members_loading: () => 'Loading members...',
  community_members_open_community: () => 'This is an open community.',
  community_members_owner_badge: () => 'Owner',
  community_members_count: (/** @type {{count: number}} */ { count }) => `${count} members`
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/components/shared/ProfileCard.svelte', () => ({
  default: function Stub() {}
}));

const holders = vi.hoisted(() => ({
  /** @type {{ isLoading: boolean, getMembers: (name: string) => string[] }} */
  profileAccess: { isLoading: false, getMembers: () => [] },
  /** @type {{pubkey: string, roles: string[]}[]} */
  admins: /** @type {{pubkey: string, roles: string[]}[]} */ ([])
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
    pointer: null,
    refresh: vi.fn(),
    members: new Set(),
    admins: holders.admins,
    isLoading: false,
    isMember: () => false,
    rolesOf: (/** @type {string} */ pk) => holders.admins.find((a) => a.pubkey === pk)?.roles ?? []
  })
}));

import MembersView from '$lib/components/community/views/MembersView.svelte';

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
  holders.admins = [];
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
  it('shows an admin chip on the owner-only branch for a bare (roles=[]) admin', () => {
    holders.admins = [{ pubkey: OWNER, roles: [] }];
    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });
    const chips = screen.getAllByTestId('member-role-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent?.trim()).toBe('admin');
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
    expect(within(adminRow).getByTestId('member-role-chip').textContent?.trim()).toBe('admin');

    const regularRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="member-row"][data-pubkey="${REGULAR}"]`)
    );
    expect(within(regularRow).queryByTestId('member-role-chip')).toBeNull();
  });

  it('a malformed roster with a duplicated role renders one chip, not a crash', () => {
    // Roles come straight off a kind 39001 event's tags — untrusted network
    // input a relay can repeat. A duplicate key in this keyed {#each} would
    // otherwise crash the whole page (each_key_duplicate).
    holders.admins = [{ pubkey: OWNER, roles: ['admin', 'admin', 'reviewer'] }];

    render(MembersView, { props: { communikeyEvent: MODERATED_EVENT_OWNER_ONLY } });

    const chips = screen.getAllByTestId('member-role-chip').map((el) => el.textContent?.trim());
    expect(chips.filter((text) => text === 'admin')).toHaveLength(1);
    expect(chips).toContain('reviewer');
  });
});
