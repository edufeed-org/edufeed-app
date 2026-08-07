/**
 * InviteToEventModal: per-recipient NIP-17 DM sending with naddr link,
 * failure tracking and retry.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

// vi.mock factories are hoisted above top-level const declarations, so
// RAW_EVENT must be created via vi.hoisted() to be usable inside the
// modal.svelte.js mock factory below (see e.g. RecoveryDownloadModal.test.js).
const RAW_EVENT = vi.hoisted(() => ({
  id: 'raw1',
  pubkey: 'c'.repeat(64),
  kind: 31923,
  content: '',
  created_at: 1718452800,
  tags: [
    ['d', 'd1'],
    ['title', 'Test Event'],
    ['start', '1718452800']
  ]
}));

// Also needs vi.hoisted() — referenced inside the action-runner mock factory below.
const runMock = vi.hoisted(() => vi.fn(async (/** @type {any[]} */ ..._args) => {}));

vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { modalProps: { rawEvent: RAW_EVENT }, closeModal: vi.fn(), openModal: vi.fn() }
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: runMock }
}));
vi.mock('$lib/services/dm-relay-backfill.js', () => ({
  ensureDmRelayList: vi.fn(async () => {})
}));
const ensureRecipientDmRelaysMock = vi.hoisted(() =>
  vi.fn(async (/** @type {string[]} */ _pubkeys) => {})
);
vi.mock('$lib/services/dm-recipient-relays.js', () => ({
  ensureRecipientDmRelays: ensureRecipientDmRelaysMock
}));
vi.mock('$lib/helpers/nostrUtils.js', async (importOriginal) => {
  const original = /** @type {any} */ (await importOriginal());
  return { ...original, encodeEventToNaddr: vi.fn(() => 'naddr1testxyz') };
});
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

import { SendWrappedMessage } from 'applesauce-actions/actions';
import InviteToEventModal from '../calendar/InviteToEventModal.svelte';

/** @param {{ getByTestId: (id: string) => HTMLElement }} r @param {string} testId */
const click = (r, testId) => r.getByTestId(testId).click();

describe('InviteToEventModal', () => {
  beforeEach(() => {
    runMock.mockClear();
    runMock.mockImplementation(async () => {});
    ensureRecipientDmRelaysMock.mockClear();
  });

  it('loads each invitee DM relay list before wrapping the invite for them', async () => {
    // SendWrappedMessage resolves recipient relays from the EventStore only.
    // Without this the invite falls through to the public fallback relays
    // instead of the relays the invitee actually reads.
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    click(r, 'stub-select-b');
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(2));

    const asked = ensureRecipientDmRelaysMock.mock.calls.flatMap((c) => c[0]);
    expect(asked).toContain(PK_A);
    expect(asked).toContain(PK_B);
  });

  it('sends one DM per recipient with note and naddr link', async () => {
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    click(r, 'stub-select-b');
    await tick();
    const note = /** @type {HTMLTextAreaElement} */ (r.getByTestId('invite-note'));
    note.value = 'Come along!';
    note.dispatchEvent(new Event('input'));
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(2));
    expect(runMock).toHaveBeenCalledWith(
      SendWrappedMessage,
      PK_A,
      'Come along!\n\nnostr:naddr1testxyz'
    );
    expect(runMock).toHaveBeenCalledWith(
      SendWrappedMessage,
      PK_B,
      'Come along!\n\nnostr:naddr1testxyz'
    );
  });

  it('sends only the link when the note is empty', async () => {
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    expect(runMock).toHaveBeenCalledWith(SendWrappedMessage, PK_A, 'nostr:naddr1testxyz');
  });

  it('marks failed recipients and retries only those', async () => {
    runMock.mockImplementation(async (/** @type {any} */ _action, /** @type {string} */ pubkey) => {
      if (pubkey === PK_B) throw new Error('relay down');
    });
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    click(r, 'stub-select-b');
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(r.queryByTestId('invite-retry')).not.toBeNull());

    runMock.mockClear();
    runMock.mockImplementation(async () => {});
    click(r, 'invite-retry');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    expect(runMock).toHaveBeenCalledWith(SendWrappedMessage, PK_B, 'nostr:naddr1testxyz');
  });

  it('never resends to a recipient already marked sent, on any send control', async () => {
    // First round: A succeeds, B fails.
    runMock.mockImplementation(async (/** @type {any} */ _action, /** @type {string} */ pubkey) => {
      if (pubkey === PK_B) throw new Error('relay down');
    });
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    click(r, 'stub-select-b');
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => expect(r.queryByTestId('invite-retry')).not.toBeNull());

    // Second round: whatever send controls are visible, clicking them all
    // must never repeat a pubkey that already succeeded (PK_A).
    runMock.mockClear();
    runMock.mockImplementation(async () => {});
    if (r.queryByTestId('invite-send')) click(r, 'invite-send');
    if (r.queryByTestId('invite-retry')) click(r, 'invite-retry');
    await vi.waitFor(() => expect(runMock).toHaveBeenCalled());
    await tick();
    const sentPubkeys = runMock.mock.calls.map((call) => call[1]);
    expect(sentPubkeys).not.toContain(PK_A);
    expect(sentPubkeys).toContain(PK_B);
  });

  it('disables the header close button and backdrop while a send is in flight', async () => {
    /** @type {() => void} */
    let resolveSend = () => {};
    runMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = () => resolve(undefined);
        })
    );
    const r = render(InviteToEventModal);
    click(r, 'stub-select-a');
    await tick();
    click(r, 'invite-send');
    await vi.waitFor(() => {
      expect(/** @type {HTMLButtonElement} */ (r.getByTestId('invite-close')).disabled).toBe(true);
    });
    const backdrop = /** @type {HTMLButtonElement} */ (
      r.container.querySelector('.modal-backdrop')
    );
    expect(backdrop.disabled).toBe(true);

    resolveSend();
    await vi.waitFor(() => {
      expect(/** @type {HTMLButtonElement} */ (r.getByTestId('invite-close')).disabled).toBe(false);
    });
  });
});
