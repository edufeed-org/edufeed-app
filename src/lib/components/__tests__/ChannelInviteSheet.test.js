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
const { PK_A, SELF } = vi.hoisted(() => ({
  PK_A: 'a'.repeat(64),
  SELF: 'f'.repeat(64)
}));

vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordClient: () => ({ invites: { forCommunity: () => [] } })
}));
// No community members → exercises the empty quick-list + empty-state hint.
vi.mock('$lib/helpers/contentTypes.js', () => ({
  getVerifiedMembers: () => ({ allMembers: [SELF], perSection: new Map() })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: { pubkey: SELF } } }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:,') } }));
vi.mock('$lib/concord/invite-helpers.js', () => ({
  pickLatestChannelInvite: () => undefined,
  createChannelInviteOnce: () => Promise.resolve({ url: 'http://x/invite/abc' })
}));
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

beforeEach(() => grantChannelAccess.mockClear());

async function openDirectTab() {
  render(ChannelInviteSheet, {
    props: {
      community,
      channel,
      communikeyEvent: { pubkey: SELF },
      canDirect: true,
      onClose: () => {}
    }
  });
  await fireEvent.click(screen.getByRole('button', { name: /Direkt einladen|Direct/i }));
}

describe('ChannelInviteSheet direct tab', () => {
  it('invites a followed contact via the picker', async () => {
    await openDirectTab();
    await fireEvent.click(await screen.findByTestId('stub-select-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('chan1', PK_A));
  });

  it('invites a pasted npub via the picker', async () => {
    await openDirectTab();
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('chan1', PK_A));
  });

  it('shows the empty-state hint when there are no quick-pick members', async () => {
    await openDirectTab();
    expect(screen.getByText(/Noch keine Mitglieder|No members to pick/)).toBeTruthy();
  });
});
