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
  useActiveUser: () => () => mockManager.active
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

const openEvent = communikeyEvent([]);

beforeEach(() => {
  toastSpy.mockClear();
  publishCommunityUpdate.mockClear();
  provisionRootGroup.mockClear();
  writeRootGroupMarker.mockClear();
  clearRootGroupMarker.mockClear();
  moderatedAvailable.value = true;
  concordFixture.value = { enabled: false, pointer: null, community: null };
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
