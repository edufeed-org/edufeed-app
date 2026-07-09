// @ts-nocheck
/**
 * RecoveryDownloadModal — radio choice (encrypted w/ password vs plain) and
 * a download trigger. The modal is opened from the Termi assistant's backup hint and from
 * the Settings entry. After a successful download we set
 * `backup-downloaded:<pubkey>` so the hint stops nagging.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const PRIVATE_KEY = generateSecretKey();
const PUBKEY = getPublicKey(PRIVATE_KEY);
const NSEC = nip19.nsecEncode(PRIVATE_KEY);

const mockActiveUser = vi.hoisted(() => ({ value: null }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'recovery-download',
  closeModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: mockModalStore
}));

const mockDownload = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/recoveryFile.js', () => ({
  downloadRecoveryFile: mockDownload,
  buildRecoveryFile: vi.fn()
}));

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_recovery_modal_title',
      'auth_recovery_modal_intro',
      'auth_recovery_modal_encrypted_label',
      'auth_recovery_modal_plain_label',
      'auth_recovery_modal_password_label',
      'auth_recovery_modal_download',
      'auth_recovery_modal_password_too_short',
      'common_cancel'
    ].map((key) => [key, () => key])
  )
);

import RecoveryDownloadModal from '../RecoveryDownloadModal.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockActiveUser.value = {
    type: 'nsec',
    pubkey: PUBKEY,
    signer: { key: PRIVATE_KEY }
  };

  if (typeof HTMLDialogElement !== 'undefined') {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      };
    }
  }
});

describe('RecoveryDownloadModal', () => {
  it('renders the encrypted/plain radio choice', () => {
    const { container } = render(RecoveryDownloadModal, {
      props: { modalId: 'recovery-1' }
    });
    expect(container.querySelector('[data-testid="recovery-mode-encrypted"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="recovery-mode-plain"]')).not.toBeNull();
  });

  it('plain mode triggers a plain-nsec download (no password) and sets backup-downloaded flag', async () => {
    const { container } = render(RecoveryDownloadModal, {
      props: { modalId: 'recovery-2' }
    });

    const plainRadio = container.querySelector('[data-testid="recovery-mode-plain"]');
    await fireEvent.click(/** @type {HTMLElement} */ (plainRadio));

    const downloadBtn = container.querySelector('[data-testid="recovery-download-btn"]');
    await fireEvent.click(/** @type {HTMLElement} */ (downloadBtn));

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const args = mockDownload.mock.calls[0][0];
    expect(args.privateKey).toBe(PRIVATE_KEY);
    expect(args.nsec).toBe(NSEC);
    expect(args.password).toBeUndefined();

    expect(localStorage.getItem(`backup-downloaded:${PUBKEY}`)).toBe('1');
  });

  it('encrypted mode requires a password of 8+ chars before download', async () => {
    const { container } = render(RecoveryDownloadModal, {
      props: { modalId: 'recovery-3' }
    });

    // Encrypted is the default; just check the password field is rendered.
    const passwordField = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="recovery-password"]')
    );
    expect(passwordField).not.toBeNull();

    // Empty password → click download → no download happens, error shown.
    const downloadBtn = container.querySelector('[data-testid="recovery-download-btn"]');
    await fireEvent.click(/** @type {HTMLElement} */ (downloadBtn));
    expect(mockDownload).not.toHaveBeenCalled();

    // Too short password → still no download.
    await fireEvent.input(passwordField, { target: { value: 'short' } });
    await fireEvent.click(/** @type {HTMLElement} */ (downloadBtn));
    expect(mockDownload).not.toHaveBeenCalled();

    // Valid password → download fires with the password.
    await fireEvent.input(passwordField, { target: { value: 'longenoughpw' } });
    await fireEvent.click(/** @type {HTMLElement} */ (downloadBtn));
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload.mock.calls[0][0].password).toBe('longenoughpw');
    expect(localStorage.getItem(`backup-downloaded:${PUBKEY}`)).toBe('1');
  });
});
