// @ts-nocheck
/** @vitest-environment jsdom */
// LogoutConfirmModal: the warning before a never-backed-up local-key account
// is removed, and the plain confirm for "Alle Konten abmelden".
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  auth_logout_unsaved_title: () => 'Ohne Sicherung abmelden?',
  auth_logout_all_title: () => 'Alle Konten abmelden?',
  auth_logout_unsaved_body_one: () => 'Dieses Konto wurde nie gesichert.',
  auth_logout_unsaved_body_many: ({ count }) => `${count} Konten wurden nie gesichert.`,
  navbar_logout_all_confirm: () => 'Wirklich alle abmelden?',
  auth_logout_anyway_action: () => 'Trotzdem abmelden',
  auth_logout_backup_action: () => 'Sicherungsdatei herunterladen',
  navbar_logout_all: () => 'Alle Konten abmelden',
  navbar_logout_current: () => 'Abmelden',
  common_cancel: () => 'Abbrechen'
}));

const { default: LogoutConfirmModal } = await import('../shared/LogoutConfirmModal.svelte');

describe('LogoutConfirmModal', () => {
  it('warns about one unsaved account and offers the backup download', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onBackup = vi.fn();
    render(LogoutConfirmModal, {
      props: { mode: 'current', count: 1, canDownload: true, onConfirm, onCancel, onBackup }
    });
    expect(screen.getByText('Ohne Sicherung abmelden?')).toBeTruthy();
    expect(screen.getByText('Dieses Konto wurde nie gesichert.')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('logout-confirm-backup'));
    expect(onBackup).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByTestId('logout-confirm-action'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('logout-confirm-action').textContent).toContain('Trotzdem abmelden');
  });

  it('counts several unsaved accounts and hides the download when the active one is safe', () => {
    render(LogoutConfirmModal, {
      props: {
        mode: 'all',
        count: 2,
        canDownload: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onBackup: vi.fn()
      }
    });
    expect(screen.getByText('2 Konten wurden nie gesichert.')).toBeTruthy();
    expect(screen.queryByTestId('logout-confirm-backup')).toBeNull();
  });

  it('is a plain confirm for logging out of all (saved) accounts', async () => {
    const onConfirm = vi.fn();
    render(LogoutConfirmModal, {
      props: { mode: 'all', count: 0, canDownload: false, onConfirm, onCancel: vi.fn() }
    });
    expect(screen.getByText('Alle Konten abmelden?')).toBeTruthy();
    expect(screen.getByText('Wirklich alle abmelden?')).toBeTruthy();
    expect(screen.getByTestId('logout-confirm-action').textContent).toContain(
      'Alle Konten abmelden'
    );
    await fireEvent.click(screen.getByTestId('logout-confirm-action'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Escape, the backdrop and Abbrechen all cancel', async () => {
    const onCancel = vi.fn();
    render(LogoutConfirmModal, { props: { count: 1, onConfirm: vi.fn(), onCancel } });
    await fireEvent.click(screen.getByTestId('logout-confirm-cancel'));
    await fireEvent.click(screen.getByTestId('logout-confirm-backdrop'));
    await fireEvent.keyDown(screen.getByTestId('logout-confirm'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});
