// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * Join requests (kind 9021) are served by the NIP-29 relay only to a session
 * authenticated as the community itself or a 39001 moderator. Holding the
 * community's key in ANOTHER account of this browser makes the members page
 * treat you as owner (writes sign with the community key), but the read
 * authenticates as the ACTIVE account — and a second AUTH on the same
 * connection is refused. So the panel used to render and fail with
 * "restricted: you're trying to access join requests you can't see"
 * (laoc, 2026-09-30, active account Edufeed, laoc42's key imported).
 *
 * Now: no REQ, no AUTH — a hint plus a switch to the community's account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const COMMUNITY = 'c'.repeat(64);
const ME = 'e'.repeat(64);
const ADMIN = 'a'.repeat(64);

const holders = vi.hoisted(() => ({
  active: null,
  communityAccount: null,
  requests: 0,
  auths: 0,
  setActive: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: () => ({
      request: () => ({
        subscribe: () => {
          holders.requests++;
          return { unsubscribe: () => {} };
        }
      })
    })
  }
}));
vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: () => {
    holders.auths++;
    return Promise.resolve({ ok: false });
  },
  isAuthRequiredError: () => false
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => holders.active,
  manager: {
    getAccountForPubkey: (pk) => (pk === 'c'.repeat(64) ? holders.communityAccount : undefined),
    setActive: (account) => holders.setActive(account)
  },
  accountsMeta: { version: 0 }
}));
vi.mock('$lib/groups/community-channels.svelte.js', () => ({
  useCommunityChannels: () => () => ({ channels: [] })
}));
vi.mock('$lib/groups/channel-rosters.svelte.js', () => ({
  useChannelRosters: () => () => ({ membersByKey: {}, adminsByKey: {} })
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));

const { default: JoinRequestsPanel } = await import(
  '$lib/components/community/settings/JoinRequestsPanel.svelte'
);

const roster = (admins = [{ pubkey: ADMIN, roles: ['admin'] }], isLoading = false) => ({
  pointer: { id: 'root', relay: 'wss://groups.example' },
  members: new Set(),
  admins,
  isLoading,
  refresh: () => {}
});

beforeEach(() => {
  holders.requests = 0;
  holders.auths = 0;
  holders.setActive.mockClear();
  holders.communityAccount = { pubkey: COMMUNITY, signer: {} };
});

describe('JoinRequestsPanel — who can read the queue', () => {
  it('loads the queue for a 39001 moderator', () => {
    holders.active = { pubkey: ADMIN, signer: {} };
    render(JoinRequestsPanel, {
      props: { communityId: COMMUNITY, roster: roster(), showEmpty: true }
    });

    expect(holders.requests).toBeGreaterThan(0);
  });

  it('loads the queue when the community account itself is active', () => {
    holders.active = { pubkey: COMMUNITY, signer: {} };
    render(JoinRequestsPanel, {
      props: { communityId: COMMUNITY, roster: roster(), showEmpty: true }
    });

    expect(holders.requests).toBeGreaterThan(0);
  });

  it('sends no request and no AUTH when another account holds the key, and offers the switch', async () => {
    holders.active = { pubkey: ME, signer: {} };
    const { getByTestId, queryByTestId } = render(JoinRequestsPanel, {
      props: { communityId: COMMUNITY, roster: roster(), showEmpty: true }
    });

    expect(holders.requests).toBe(0);
    expect(holders.auths).toBe(0);
    expect(getByTestId('join-requests-other-account')).toBeTruthy();
    expect(queryByTestId('join-requests-error')).toBeNull();

    await fireEvent.click(getByTestId('join-requests-switch-account'));
    expect(holders.setActive).toHaveBeenCalledWith(holders.communityAccount);
  });

  it('renders nothing for a plain member without the key', () => {
    holders.active = { pubkey: ME, signer: {} };
    holders.communityAccount = undefined;
    const { container } = render(JoinRequestsPanel, {
      props: { communityId: COMMUNITY, roster: roster(), showEmpty: true }
    });

    expect(holders.requests).toBe(0);
    expect(container.textContent.trim()).toBe('');
  });

  it('waits for the roster instead of flashing the hint at a real moderator', () => {
    holders.active = { pubkey: ADMIN, signer: {} };
    const { queryByTestId } = render(JoinRequestsPanel, {
      props: { communityId: COMMUNITY, roster: roster([], true), showEmpty: true }
    });

    expect(queryByTestId('join-requests-other-account')).toBeNull();
    expect(holders.requests).toBe(0);
  });
});
