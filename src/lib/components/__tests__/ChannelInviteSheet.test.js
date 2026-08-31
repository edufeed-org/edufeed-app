/** @vitest-environment jsdom */
/**
 * ChannelInviteSheet — direct-invite picker. The Direct tab must let you
 * invite anyone via the shared ContactSearchInput (follows search + npub
 * paste), each selection calling grantChannelAccess, and show a real
 * empty-state hint when there are no quick-pick members.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

// vi.mock factories below are hoisted above these consts, so PK_A/SELF must
// be declared via vi.hoisted() to avoid a "Cannot access before
// initialization" TDZ error at hoist time.
const { PK_A, SELF, COMMUNITY_PK } = vi.hoisted(() => ({
  PK_A: 'a'.repeat(64),
  SELF: 'f'.repeat(64),
  COMMUNITY_PK: 'c'.repeat(64)
}));

vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordClient: () => ({ invites: { forCommunity: () => [] } })
}));
// Members include self AND the community's own pubkey (a separate-keypair
// owner scenario) — the empty-quick-list tests below expect both filtered
// out, leaving nothing to pick.
vi.mock('$lib/helpers/contentTypes.js', () => ({
  getVerifiedMembers: () => ({ allMembers: [SELF, COMMUNITY_PK], perSection: new Map() })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: { pubkey: SELF } } }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:,') } }));
const { pickLatestChannelInvite, createChannelInviteOnce } = vi.hoisted(() => ({
  pickLatestChannelInvite: vi.fn(() => undefined),
  createChannelInviteOnce: vi.fn(() => Promise.resolve({ url: 'http://x/invite/abc' }))
}));
vi.mock('$lib/concord/invite-helpers.js', () => ({
  pickLatestChannelInvite,
  createChannelInviteOnce
}));
const directInviteToArea = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/concord/area-invite.js', () => ({ directInviteToArea }));
vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
// getContext('profileAccess') → a stub with the ProfileListAccess shape.
vi.mock('svelte', async (importOriginal) => {
  const actual = /** @type {Record<string, any>} */ (await importOriginal());
  return { ...actual, getContext: () => ({ getMembers: () => [], isLoading: false }) };
});

import ChannelInviteSheet from '$lib/components/community/channels/ChannelInviteSheet.svelte';

const grantChannelAccess = vi.fn(() => Promise.resolve());
const community = { communityId: 'cid', grantChannelAccess };
const channel = { channel_id: 'chan1', name: 'ideen', private: true };

beforeEach(() => {
  grantChannelAccess.mockClear();
  showToast.mockClear();
});

/** @param {any} ch */
function renderSheet(ch) {
  render(ChannelInviteSheet, {
    props: {
      community,
      channel: ch,
      communikeyEvent: { pubkey: COMMUNITY_PK },
      canDirect: true,
      onClose: () => {}
    }
  });
}

/** @param {any} ch */
async function openDirect(ch) {
  renderSheet(ch);
  await fireEvent.click(screen.getByRole('button', { name: /Direkt einladen|Direct/i }));
}

async function openDirectTab() {
  await openDirect(channel);
}

describe('ChannelInviteSheet direct tab', () => {
  it('invites a followed contact via the picker', async () => {
    await openDirectTab();
    await fireEvent.click(await screen.findByTestId('stub-select-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('chan1', PK_A));
  });

  it('invites a pasted npub via the picker and confirms with a success toast', async () => {
    await openDirectTab();
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('chan1', PK_A));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), 'success'));
  });

  it('shows the empty-state hint when there are no quick-pick members', async () => {
    await openDirectTab();
    expect(screen.getByText(/Noch keine Mitglieder|No members to pick/)).toBeTruthy();
  });

  it('excludes the community pubkey (not just self) from both the quick-pick list and the search input', async () => {
    await openDirectTab();
    // Neither self nor the community's own pubkey should render as a
    // quick-pick row — a separate-keypair owner must not be offered the
    // community itself as an invitable "member" (handoff #12).
    expect(screen.queryByText(SELF.slice(0, 12))).toBeNull();
    expect(screen.queryByText(COMMUNITY_PK.slice(0, 12))).toBeNull();
    const excludeText = (await screen.findByTestId('stub-exclude')).textContent;
    expect(excludeText).toContain(SELF);
    expect(excludeText).toContain(COMMUNITY_PK);
  });
});

// Public (#) channels have no per-channel key: grantChannelAccess only knows
// how to hand over PRIVATE channel keys and throws otherwise ("not a private
// channel we hold a key for"). Both invite paths must route a public channel
// through the AREA invite instead (directInviteToArea / channels: []).
describe('ChannelInviteSheet public vs private routing', () => {
  const publicChannel = { channel_id: 'general', name: 'general', private: false };
  const privateChannel = { channel_id: 'c2', name: 'ideen', private: true };

  beforeEach(() => {
    directInviteToArea.mockClear();
    grantChannelAccess.mockClear();
    createChannelInviteOnce.mockClear();
    pickLatestChannelInvite.mockClear();
  });

  it('public channel: direct invite routes to directInviteToArea, not grantChannelAccess', async () => {
    await openDirect(publicChannel);
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await waitFor(() => expect(directInviteToArea).toHaveBeenCalledWith(community, PK_A));
    expect(grantChannelAccess).not.toHaveBeenCalled();
  });

  it('private channel: direct invite uses grantChannelAccess(channelId, pubkey)', async () => {
    await openDirect(privateChannel);
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('c2', PK_A));
    expect(directInviteToArea).not.toHaveBeenCalled();
  });

  it('public channel: link mint requests an AREA invite (channels: [])', async () => {
    renderSheet(publicChannel);
    await waitFor(() =>
      expect(createChannelInviteOnce).toHaveBeenCalledWith(
        community,
        'area',
        expect.objectContaining({ channels: [] })
      )
    );
  });

  it('private channel: link mint requests a per-channel invite (channels: [channelId])', async () => {
    renderSheet(privateChannel);
    await waitFor(() =>
      expect(createChannelInviteOnce).toHaveBeenCalledWith(
        community,
        'c2',
        expect.objectContaining({ channels: ['c2'] })
      )
    );
  });

  it('picks an existing invite using channel.private as the isPrivate flag', async () => {
    renderSheet(publicChannel);
    await waitFor(() =>
      expect(pickLatestChannelInvite).toHaveBeenCalledWith(expect.anything(), 'general', false)
    );
  });
});
