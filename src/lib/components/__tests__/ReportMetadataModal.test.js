/**
 * ReportMetadataModal — store-driven modal that sends a private NIP-17 DM to a
 * resource author flagging wrong metadata. Reads the target event from
 * modalStore.modalProps, gates submit on field+comment, and sends via
 * actionRunnerOptimistic + SendWrappedMessage.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
}

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'report_metadata_modal_title',
      'report_metadata_modal_description',
      'report_metadata_field_label',
      'report_metadata_field_placeholder',
      'report_metadata_field_license',
      'report_metadata_field_attribution',
      'report_metadata_field_title',
      'report_metadata_field_subject',
      'report_metadata_field_other',
      'report_metadata_comment_label',
      'report_metadata_comment_placeholder',
      'report_metadata_submit',
      'report_metadata_success',
      'report_metadata_error',
      'common_cancel'
    ].map((k) => [k, () => k])
  )
);

const mockEvent = {
  kind: 30142,
  pubkey: 'author_pubkey_hex',
  tags: [
    ['d', 'res-1'],
    ['title', 'Intro to Algebra']
  ]
};

const mockModalStore = vi.hoisted(() => ({
  modalProps: /** @type {any} */ ({}),
  closeModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: mockModalStore
}));

const mockRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: mockRun }
}));

vi.mock('applesauce-actions/actions', () => ({
  SendWrappedMessage: 'SendWrappedMessage'
}));

vi.mock('$lib/services/dm-relay-backfill.js', () => ({
  ensureDmRelayList: vi.fn().mockResolvedValue(undefined)
}));

const mockEnsureRecipientDmRelays = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/services/dm-recipient-relays.js', () => ({
  ensureRecipientDmRelays: mockEnsureRecipientDmRelays
}));

const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast.js', () => ({
  showToast: mockShowToast
}));

vi.mock('$lib/helpers/eventRouteRedirect.js', () => ({
  getCanonicalEventRoute: () => '/naddr1abc'
}));

import ReportMetadataModal from '../shared/ReportMetadataModal.svelte';

/** @param {any} screen */
async function fillForm(screen, { field = 'License', comment = 'License is wrong' } = {}) {
  const select = screen.getByLabelText('report_metadata_field_label');
  await fireEvent.change(select, { target: { value: field } });
  const textarea = screen.getByLabelText('report_metadata_comment_label');
  await fireEvent.input(textarea, { target: { value: comment } });
}

describe('ReportMetadataModal', () => {
  beforeEach(() => {
    mockModalStore.modalProps = { event: mockEvent };
    mockModalStore.closeModal.mockClear();
    mockRun.mockClear();
    mockRun.mockResolvedValue(undefined);
    mockShowToast.mockClear();
    mockEnsureRecipientDmRelays.mockClear();
  });

  it('loads the author DM relay list before wrapping the feedback', async () => {
    // SendWrappedMessage resolves recipient relays from the EventStore only, so
    // without this the feedback DM goes to the public fallback relays instead
    // of the author's own inbox.
    const screen = render(ReportMetadataModal);
    await fillForm(screen);
    await fireEvent.click(screen.getByText('report_metadata_submit'));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockEnsureRecipientDmRelays).toHaveBeenCalledWith([mockEvent.pubkey]);
    expect(mockEnsureRecipientDmRelays.mock.invocationCallOrder[0]).toBeLessThan(
      mockRun.mock.invocationCallOrder[0]
    );
  });

  it('disables submit until a field is chosen and the comment is non-empty', async () => {
    const screen = render(ReportMetadataModal);
    const submit = /** @type {HTMLButtonElement} */ (screen.getByText('report_metadata_submit'));
    expect(submit.disabled).toBe(true);

    const select = screen.getByLabelText('report_metadata_field_label');
    await fireEvent.change(select, { target: { value: 'License' } });
    expect(submit.disabled).toBe(true);

    const textarea = screen.getByLabelText('report_metadata_comment_label');
    await fireEvent.input(textarea, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);

    await fireEvent.input(textarea, { target: { value: 'License is wrong' } });
    expect(submit.disabled).toBe(false);
  });

  it('sends a wrapped DM to the author with the built body on submit', async () => {
    const screen = render(ReportMetadataModal);
    await fillForm(screen, { comment: 'License should be CC-BY-SA' });
    await fireEvent.click(screen.getByText('report_metadata_submit'));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRun).toHaveBeenCalledTimes(1);
    const [action, recipients, body] = mockRun.mock.calls[0];
    expect(action).toBe('SendWrappedMessage');
    expect(recipients).toEqual(['author_pubkey_hex']);
    expect(body).toContain('[Metadata feedback via edufeed]');
    expect(body).toContain('Intro to Algebra');
    expect(body).toContain('License should be CC-BY-SA');
  });

  it('uses the AMB `name` tag for the resource title (kind 30142)', async () => {
    mockModalStore.modalProps = {
      event: {
        kind: 30142,
        pubkey: 'author_pubkey_hex',
        tags: [
          ['d', 'res-1'],
          ['name', 'WIR übernehmen Verantwortung']
        ]
      }
    };
    const screen = render(ReportMetadataModal);
    await fillForm(screen);
    await fireEvent.click(screen.getByText('report_metadata_submit'));
    await new Promise((r) => setTimeout(r, 0));

    const [, , body] = mockRun.mock.calls[0];
    expect(body).toContain('WIR übernehmen Verantwortung');
  });

  it('closes the modal and shows a success toast on success', async () => {
    const screen = render(ReportMetadataModal);
    await fillForm(screen);
    await fireEvent.click(screen.getByText('report_metadata_submit'));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockShowToast).toHaveBeenCalledWith('report_metadata_success', 'success');
    expect(mockModalStore.closeModal).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open and shows an error toast on failure', async () => {
    mockRun.mockRejectedValueOnce(new Error('relay down'));
    const screen = render(ReportMetadataModal);
    await fillForm(screen);
    await fireEvent.click(screen.getByText('report_metadata_submit'));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockShowToast).toHaveBeenCalledWith('report_metadata_error', 'error');
    expect(mockModalStore.closeModal).not.toHaveBeenCalled();
  });
});
