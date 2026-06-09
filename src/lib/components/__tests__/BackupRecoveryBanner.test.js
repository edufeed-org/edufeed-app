// @ts-nocheck
/**
 * BackupRecoveryBanner — non-blocking post-login nudge.
 *
 * Visible ONLY for nsec-style accounts (PrivateKeyAccount / SimpleAccount
 * — type === 'nsec'). Extension and remote-signer accounts do not need the
 * recovery file. Hides on either of two flags so a dismiss doesn't lie about
 * backup state:
 *  - backup-downloaded:<pubkey>          (set after a successful download)
 *  - backup-banner-dismissed:<pubkey>    (set when user explicitly dismisses)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, fireEvent } from '@testing-library/svelte';

const mockActiveUser = vi.hoisted(() => ({ value: null }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));

const mockModalStore = vi.hoisted(() => ({
  activeModal: null,
  openModal: vi.fn(),
  closeModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: mockModalStore
}));

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_backup_banner_title',
      'auth_backup_banner_body',
      'auth_backup_banner_download_cta',
      'auth_backup_banner_dismiss',
      'common_dismiss'
    ].map((key) => [key, () => key])
  )
);

import BackupRecoveryBanner from '../BackupRecoveryBanner.svelte';
import { markBackupDownloaded } from '$lib/stores/backup-flags.svelte.js';

const NSEC_PUBKEY = 'a'.repeat(64);
const EXT_PUBKEY = 'b'.repeat(64);

function nsecAccount() {
  return { type: 'nsec', pubkey: NSEC_PUBKEY };
}
function extensionAccount() {
  return { type: 'extension', pubkey: EXT_PUBKEY };
}
function nostrConnectAccount() {
  return { type: 'nostr-connect', pubkey: EXT_PUBKEY };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockActiveUser.value = null;
  // Default-on for the existing tests: they assert nsec-account behavior
  // assuming the user just signed up. The dedicated "no flag" test below
  // clears this in its own setup.
  localStorage.setItem(`signed-up-here:${NSEC_PUBKEY}`, '1');
});

describe('BackupRecoveryBanner', () => {
  it('renders nothing when there is no active user', () => {
    mockActiveUser.value = null;
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('renders the banner for an nsec account with no flags set', () => {
    mockActiveUser.value = nsecAccount();
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).not.toBeNull();
  });

  it('does NOT render for an extension account', () => {
    mockActiveUser.value = extensionAccount();
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('does NOT render for a nostr-connect (bunker) account', () => {
    mockActiveUser.value = nostrConnectAccount();
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('does NOT render for an nsec account that did NOT sign up via the in-app wizard', () => {
    // No `signed-up-here:<pubkey>` flag = pre-existing or paste-imported
    // nsec account; we shouldn't pester them about backups.
    localStorage.removeItem(`signed-up-here:${NSEC_PUBKEY}`);
    mockActiveUser.value = nsecAccount();
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('hides when `backup-downloaded:<pubkey>` flag is set', () => {
    mockActiveUser.value = nsecAccount();
    localStorage.setItem(`backup-downloaded:${NSEC_PUBKEY}`, '1');
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('hides when `backup-banner-dismissed:<pubkey>` flag is set', () => {
    mockActiveUser.value = nsecAccount();
    localStorage.setItem(`backup-banner-dismissed:${NSEC_PUBKEY}`, '1');
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('clicking dismiss persists `backup-banner-dismissed:<pubkey>` and hides the banner', async () => {
    mockActiveUser.value = nsecAccount();
    const { container } = render(BackupRecoveryBanner);

    const dismissBtn = container.querySelector('[data-testid="backup-banner-dismiss"]');
    expect(dismissBtn).not.toBeNull();
    await fireEvent.click(/** @type {HTMLElement} */ (dismissBtn));

    expect(localStorage.getItem(`backup-banner-dismissed:${NSEC_PUBKEY}`)).toBe('1');
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('hides reactively when markBackupDownloaded() is called after render (no reload needed)', async () => {
    // Reproduces the bug: the recovery modal completes a download and marks
    // the user's backup as saved, but the banner kept its stale view of
    // localStorage and stayed visible until the next reload.
    mockActiveUser.value = nsecAccount();
    const { container } = render(BackupRecoveryBanner);
    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).not.toBeNull();

    markBackupDownloaded(NSEC_PUBKEY);
    await tick();

    expect(container.querySelector('[data-testid="backup-recovery-banner"]')).toBeNull();
  });

  it('clicking the download CTA opens the recovery-download modal', async () => {
    mockActiveUser.value = nsecAccount();
    const { container } = render(BackupRecoveryBanner);

    const downloadBtn = container.querySelector('[data-testid="backup-banner-download"]');
    expect(downloadBtn).not.toBeNull();
    await fireEvent.click(/** @type {HTMLElement} */ (downloadBtn));

    expect(mockModalStore.openModal).toHaveBeenCalledWith('recovery-download');
  });
});
