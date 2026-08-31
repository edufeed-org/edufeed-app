/** @vitest-environment jsdom */
/**
 * PrivateChannelsView — owner-gating split (Concord follow-up 1 review):
 * `isCommunikeyOwner` (key-holding: the manager holds the community's own
 * signer, via getCommunitySigner/isCommunityOwner — NOT active-account
 * equality, since owners running a community from a separate keypair still
 * get the founding pane, handoff #12) vs `isConcordOwner`
 * (concord.community.material.owner === active user, relevant once a
 * community exists — including the standalone `/private/<id>` route, which
 * never has a communikeyEvent at all). See the long comment above these
 * derivations in PrivateChannelsView.svelte.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), signer: {} },
  // Accounts the manager holds signers for, keyed by pubkey. Defaults to
  // just the active account (registered under its own pubkey), matching a
  // normal single-account login.
  accounts: new Map([['a'.repeat(64), { pubkey: 'a'.repeat(64), signer: {} }]]),
  getAccountForPubkey(/** @type {string} */ pk) {
    return this.accounts.get(pk);
  }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active,
  accountsMeta: { version: 0 }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true } },
  configReady: { subscribe: () => () => {} }
}));

vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

/** Mutable holder so each test can control useConcordArea's return value. */
const holders = vi.hoisted(() => ({
  concord: /** @type {any} */ ({
    enabled: true,
    community: undefined,
    channels: [],
    phase: 'idle',
    dissolved: false,
    signerHasNip44: false,
    canManageChannels: false,
    canCreateInvite: false
  })
}));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordArea: () => () => holders.concord
}));

import PrivateChannelsView from '$lib/components/community/channels/PrivateChannelsView.svelte';

describe('PrivateChannelsView — owner gating', () => {
  beforeEach(() => {
    // Reset to the default single-account state before every test — several
    // tests below mutate mockManager.active/accounts to exercise the
    // separate-keypair case and must not leak into their neighbors.
    mockManager.active = { pubkey: OWNER, signer: {} };
    mockManager.accounts = new Map([[OWNER, { pubkey: OWNER, signer: {} }]]);
  });

  it('shows the founding pane only when isCommunikeyOwner (owner + no community)', () => {
    holders.concord = { ...holders.concord, community: undefined };
    render(PrivateChannelsView, {
      props: { communikeyEvent: { kind: 10222, pubkey: OWNER, tags: [], content: '' } }
    });
    expect(screen.getAllByTestId('concord-new-channel').length).toBeGreaterThan(0);
  });

  it('hides the founding pane when communikeyEvent belongs to someone else', () => {
    holders.concord = { ...holders.concord, community: undefined };
    render(PrivateChannelsView, {
      props: { communikeyEvent: { kind: 10222, pubkey: OTHER, tags: [], content: '' } }
    });
    expect(screen.queryByTestId('concord-new-channel')).toBeNull();
  });

  it('shows the founding pane when the active account differs from the community pubkey but the manager holds the community key (separate-keypair owner, handoff #12)', () => {
    // Active account is a personal keypair distinct from the community's
    // own; the manager ALSO holds the community's signer (imported
    // separately) — key-holding semantics say this is still the owner.
    const ACTIVE_PERSONAL = 'd'.repeat(64);
    mockManager.active = { pubkey: ACTIVE_PERSONAL, signer: {} };
    mockManager.accounts = new Map([
      [ACTIVE_PERSONAL, { pubkey: ACTIVE_PERSONAL, signer: {} }],
      [OWNER, { pubkey: OWNER, signer: {} }]
    ]);
    holders.concord = { ...holders.concord, community: undefined };
    render(PrivateChannelsView, {
      props: { communikeyEvent: { kind: 10222, pubkey: OWNER, tags: [], content: '' } }
    });
    expect(screen.getAllByTestId('concord-new-channel').length).toBeGreaterThan(0);
  });

  it('renders the new-channel affordance for a Concord-owned community with no communikeyEvent (standalone route)', () => {
    holders.concord = {
      ...holders.concord,
      community: { material: { owner: OWNER } },
      canManageChannels: true
    };
    render(PrivateChannelsView, { props: { communityId: 'c'.repeat(64) } });
    expect(screen.getAllByTestId('concord-new-channel').length).toBeGreaterThan(0);
  });

  it('hides the new-channel affordance when material.owner is not the active user and canManageChannels is false', () => {
    holders.concord = {
      ...holders.concord,
      community: { material: { owner: OTHER } },
      canManageChannels: false
    };
    render(PrivateChannelsView, { props: { communityId: 'c'.repeat(64) } });
    expect(screen.queryByTestId('concord-new-channel')).toBeNull();
  });

  it('renders the new-channel affordance for a non-owner with canManageChannels (delegated admin)', () => {
    holders.concord = {
      ...holders.concord,
      community: { material: { owner: OTHER } },
      canManageChannels: true
    };
    render(PrivateChannelsView, { props: { communityId: 'c'.repeat(64) } });
    expect(screen.getAllByTestId('concord-new-channel').length).toBeGreaterThan(0);
  });

  it('hides the new-channel affordance for the owner when canManageChannels is false', () => {
    holders.concord = {
      ...holders.concord,
      community: { material: { owner: OWNER } },
      canManageChannels: false
    };
    render(PrivateChannelsView, { props: { communityId: 'c'.repeat(64) } });
    expect(screen.queryByTestId('concord-new-channel')).toBeNull();
  });
});
