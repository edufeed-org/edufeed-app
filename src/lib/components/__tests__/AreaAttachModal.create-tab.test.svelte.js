/** @vitest-environment jsdom */
/**
 * AreaAttachModal — the group tab's "create new" sub-mode: mint a fresh
 * NIP-29 group on a relay, then attach it as a channel of this community in
 * one flow (Stufe A3 completion). The attach sub-mode has its own test file
 * (AreaAttachModal.group-tab.test.svelte.js); this one only proves the
 * segmented control and the create→attach wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const GROUP_ID = 'deadbeefcafef00d';
const RELAY = 'wss://groups.example/';

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'f'.repeat(64), signer: { sign: () => {} } },
  getAccountForPubkey: vi.fn(() => ({ signer: { sign: () => {} } }))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));

const showToast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast }));

vi.mock('$lib/concord/attach.js', () => ({ attachConcordArea: vi.fn() }));
vi.mock('$lib/concord/unlinked-areas.svelte.js', () => ({
  useAttachableConcordAreas: () => () => []
}));

// PARTIAL: this module also exports attachableAreaModes and the template
// builders, which the component needs for real — only attachGroupChannel is
// a spy.
const attachGroupChannel = vi.hoisted(() => vi.fn(async (/** @type {any} */ _args) => ({})));
vi.mock('$lib/groups/community-attach.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, attachGroupChannel };
});

const { createGroupOnRelay, generateGroupId } = vi.hoisted(() => ({
  createGroupOnRelay: vi.fn(async (/** @type {any} */ _args) => ({
    kind: 39000,
    tags: [['d', GROUP_ID]]
  })),
  generateGroupId: vi.fn(() => GROUP_ID)
}));
vi.mock('$lib/groups/group-management.js', () => ({ createGroupOnRelay, generateGroupId }));

vi.mock('$lib/helpers/relay-helper.js', () => ({ getGroupsRelays: () => [RELAY] }));

const relayConnStub = { publish: vi.fn(), request: vi.fn() };
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relayConnStub) }
}));

import AreaAttachModal from '$lib/components/community/channels/AreaAttachModal.svelte';

/** @param {string[][]} extraTags */
const community = (extraTags = []) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  created_at: 1,
  tags: [['d', 'relilab'], ...extraTags]
});

/** @param {any} props */
function open(props = {}) {
  return render(AreaAttachModal, {
    props: { communikeyEvent: community(), onClose: () => {}, ...props }
  });
}

/** Opens the group tab, then switches to the create sub-mode. */
async function openCreateMode(props = {}) {
  open(props);
  await fireEvent.click(screen.getByTestId('attach-tab-group'));
  await fireEvent.click(screen.getByTestId('group-mode-create'));
}

describe('AreaAttachModal — creating a new NIP-29 group', () => {
  beforeEach(() => {
    attachGroupChannel.mockClear();
    createGroupOnRelay.mockClear();
    generateGroupId.mockClear();
    showToast.mockClear();
  });

  it('create mode prefills the deployment relay and defaults private+closed', async () => {
    await openCreateMode();
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-create-relay')).value).toBe(
      RELAY
    );
    expect(
      /** @type {HTMLInputElement} */ (screen.getByTestId('group-create-public')).checked
    ).toBe(false);
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-create-open')).checked).toBe(
      false
    );
  });

  it('disables submit until a name and a valid relay are present', async () => {
    await openCreateMode();
    const confirm = /** @type {HTMLButtonElement} */ (screen.getByTestId('group-create-confirm'));
    // Untouched form: no name yet.
    expect(confirm.disabled).toBe(true);

    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    // Name present, relay still prefilled valid → enabled.
    expect(confirm.disabled).toBe(false);

    await fireEvent.input(screen.getByTestId('group-create-relay'), { target: { value: '' } });
    expect(confirm.disabled).toBe(true);

    await fireEvent.input(screen.getByTestId('group-create-relay'), {
      target: { value: RELAY }
    });
    expect(confirm.disabled).toBe(false);
  });

  it('creates on the chosen relay then attaches with the community signer', async () => {
    const onAttached = vi.fn();
    const onClose = vi.fn();
    await openCreateMode({ onAttached, onClose });

    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    await fireEvent.click(screen.getByTestId('group-create-confirm'));

    await vi.waitFor(() => expect(createGroupOnRelay).toHaveBeenCalledTimes(1));
    const createArgs = createGroupOnRelay.mock.calls[0][0];
    expect(createArgs.id).toBe(GROUP_ID);
    expect(createArgs.relayConn).toBe(relayConnStub);
    expect(createArgs.metadata).toEqual(
      expect.objectContaining({ name: 'Mathe', isPublic: false, isOpen: false })
    );
    expect(createArgs.user).toBe(mockManager.active);

    await vi.waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    const attachArgs = attachGroupChannel.mock.calls[0][0];
    expect(attachArgs.pointer).toEqual({
      id: GROUP_ID,
      relay: RELAY,
      name: 'Mathe',
      access: 'invited'
    });
    expect(attachArgs.communitySigner).toBeTruthy();

    await vi.waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open and toasts on failure', async () => {
    createGroupOnRelay.mockRejectedValueOnce(new Error('relay rejected the event'));
    const onClose = vi.fn();
    await openCreateMode({ onClose });

    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    await fireEvent.click(screen.getByTestId('group-create-confirm'));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-create-confirm')).toBeTruthy();
  });
});
