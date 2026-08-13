/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const CH1 = { channel_id: 'c1', name: 'alpha', private: false, accessible: true };
const CH2 = { channel_id: 'c2', name: 'beta', private: true, accessible: true };
const RELAY = 'wss://groups.example/';

const gotoSpy = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: gotoSpy }));

// isCommunikeyOwner (getCommunitySigner) reads `manager` directly — only
// `useActiveUser` was mocked before this file needed a communikeyEvent-based
// owner check (the onCreated/group-mode test below). vi.hoisted's factory
// runs before module-scope `const OWNER` is initialized, so it is inlined
// here rather than reused (same pattern as the sibling test files).
const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), signer: {} },
  getAccountForPubkey: (/** @type {string} */ pk) =>
    pk === 'a'.repeat(64) ? { pubkey: 'a'.repeat(64), signer: {} } : undefined
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active,
  accountsMeta: { version: 0 }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true, relays: [] } }
}));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  channelUnreadState: () => ({ unread: false, mentioned: false }),
  markChannelRead: vi.fn(),
  getToastsEnabled: () => false,
  setToastsEnabled: vi.fn()
}));
const selectSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/concord/active-channel.svelte.js', () => ({
  setActiveConcordChannel: vi.fn(),
  clearActiveConcordChannel: vi.fn(),
  selectConcordChannel: selectSpy,
  getSelectedConcordChannel: () => 'c2' // active = CH2 (beta)
}));
const deleteChannel = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const concordFixture = vi.hoisted(() => /** @type {{ value: any }} */ ({ value: null }));
vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordArea: () => () => concordFixture.value
}));
// Stub ChannelChat: expose buttons to invoke openOverlay, and echo the props we assert on.
// The mock factory must itself be `async` for the top-level `await import(...)`
// inside it to be valid — vitest supports async `vi.mock` factories, but the
// arrow function needs the `async` keyword or this is a syntax error.
vi.mock('$lib/components/community/channels/ChannelChat.svelte', async () => ({
  default: (await import('./fixtures/ChannelChatStub.svelte')).default
}));
// Stub the wizard to capture the `community` prop it receives.
vi.mock('$lib/components/community/channels/ChannelCreateWizard.svelte', async () => ({
  default: (await import('./fixtures/ChannelCreateWizardStub.svelte')).default
}));

const { default: PrivateChannelsView } = await import(
  '$lib/components/community/channels/PrivateChannelsView.svelte'
);
const { groupHref } = await import('$lib/groups/groups.js');

function base(overrides = {}) {
  return {
    enabled: true,
    phase: 'ready',
    community: { material: { owner: OWNER }, deleteChannel },
    communityId: 'cid',
    channels: [CH1, CH2],
    dissolved: false,
    signerHasNip44: true,
    ...overrides
  };
}
beforeEach(() => {
  toastSpy.mockClear();
  selectSpy.mockClear();
  deleteChannel.mockClear();
  gotoSpy.mockClear();
});

describe('PrivateChannelsView management', () => {
  it('deletes the active channel and re-selects a survivor', async () => {
    concordFixture.value = base();
    render(PrivateChannelsView, {
      props: { communityId: 'cid', communityProfile: { name: 'Area' } }
    });
    await fireEvent.click(await screen.findByTestId('stub-open-delete-channel')); // ChannelChatStub → openOverlay('delete-channel')
    await fireEvent.click(await screen.findByTestId('concord-delete-channel-confirm'));
    await waitFor(() => expect(deleteChannel).toHaveBeenCalledWith('c2'));
    expect(selectSpy).toHaveBeenCalledWith('cid', 'c1');
  });

  it('disables the dissolve confirm until the area name is typed', async () => {
    concordFixture.value = base();
    render(PrivateChannelsView, {
      props: { communityId: 'cid', communityProfile: { name: 'Area' } }
    });
    await fireEvent.click(await screen.findByTestId('stub-open-dissolve'));
    const confirm = /** @type {HTMLButtonElement} */ (
      await screen.findByTestId('concord-dissolve-confirm')
    );
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByTestId('concord-dissolve-confirm-input'), {
      target: { value: 'Area' }
    });
    expect(confirm.disabled).toBe(false);
  });

  it('passes community=undefined to the wizard when dissolved (force-found)', async () => {
    concordFixture.value = base({ dissolved: true });
    render(PrivateChannelsView, {
      props: { communityId: 'cid', communityProfile: { name: 'Area' } }
    });
    await fireEvent.click(await screen.findByTestId('stub-open-create'));
    await waitFor(() =>
      expect(screen.getByTestId('wizard-community').textContent).toBe('undefined')
    );
  });
});

describe('PrivateChannelsView management — navigate into a freshly created channel (handoff #10)', () => {
  it('Concord creation: selects the new channel, no navigation', async () => {
    concordFixture.value = base();
    render(PrivateChannelsView, {
      props: { communityId: 'cid', communityProfile: { name: 'Area' } }
    });
    await fireEvent.click(await screen.findByTestId('stub-open-create'));
    await fireEvent.click(await screen.findByTestId('stub-fire-created'));
    expect(selectSpy).toHaveBeenCalledWith('cid', 'new-id');
    expect(gotoSpy).not.toHaveBeenCalled();
  });

  it('NIP-29 group creation: navigates into the new channel instead of selecting a concord channel', async () => {
    concordFixture.value = base({ community: undefined, enabled: false });
    const communikeyEvent = {
      kind: 10222,
      pubkey: OWNER,
      tags: [['group', 'allgemein', RELAY, 'Allgemein', 'members']]
    };
    render(PrivateChannelsView, {
      props: { communikeyEvent, communityProfile: { name: 'Area' } }
    });
    await fireEvent.click(await screen.findByTestId('concord-new-channel'));
    await fireEvent.click(await screen.findByTestId('stub-fire-created'));
    expect(gotoSpy).toHaveBeenCalledWith(groupHref({ id: 'new-id', relay: RELAY }));
    expect(selectSpy).not.toHaveBeenCalled();
  });
});

describe('PrivateChannelsView management — area-members-open is member/owner-gated (handoff #11c)', () => {
  /** @param {string} pubkey */
  const communikeyEventFor = (pubkey) => ({
    kind: 10222,
    pubkey,
    tags: [['group', 'allgemein', RELAY, 'Allgemein', 'members']]
  });

  it('shows the entry to the community owner', () => {
    concordFixture.value = base({ community: undefined, enabled: false });
    render(PrivateChannelsView, {
      props: {
        communikeyEvent: communikeyEventFor('a'.repeat(64)),
        communityProfile: { name: 'Area' }
      }
    });
    expect(screen.getByTestId('area-members-open')).toBeTruthy();
  });

  it('hides the entry from a visitor who is neither owner nor a roster/Concord member', () => {
    concordFixture.value = base({ community: undefined, enabled: false });
    render(PrivateChannelsView, {
      props: {
        communikeyEvent: communikeyEventFor('b'.repeat(64)),
        communityProfile: { name: 'Area' }
      }
    });
    expect(screen.queryByTestId('area-members-open')).toBeNull();
  });
});
