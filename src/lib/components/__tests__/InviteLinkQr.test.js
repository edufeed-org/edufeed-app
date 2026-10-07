/** @vitest-environment jsdom */
/**
 * InviteLinkQr — link text + copy button + QR image for community invites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { toDataURL, showToast } = vi.hoisted(() => ({
  toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,QR')),
  showToast: vi.fn()
}));
vi.mock('qrcode', () => ({ default: { toDataURL } }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('$lib/paraglide/messages', () => ({
  community_invite_link_copy: () => 'Link kopieren',
  community_invite_link_copied: () => 'Link kopiert.',
  community_invite_link_copy_failed: (/** @type {{reason: string}} */ p) =>
    `Link konnte nicht kopiert werden: ${p.reason}`,
  community_invite_clipboard_unavailable: () => 'Zwischenablage nicht verfügbar',
  community_invite_qr_alt: () => 'QR-Code für den Einladungslink'
}));

import InviteLinkQr from '../community/InviteLinkQr.svelte';

const URL_ = 'http://localhost/c/npub1test?join=ABC123';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InviteLinkQr', () => {
  it('shows the link and renders a QR code of it', async () => {
    render(InviteLinkQr, { props: { url: URL_, testid: 'invite' } });
    expect(screen.getByTestId('invite-url').textContent).toContain(URL_);
    expect(toDataURL).toHaveBeenCalledWith(URL_, expect.any(Object));
    const img = /** @type {HTMLImageElement} */ (await screen.findByTestId('invite-qr'));
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QR');
    expect(img.getAttribute('alt')).toBe('QR-Code für den Einladungslink');
  });

  it('copies the link to the clipboard and toasts', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(InviteLinkQr, { props: { url: URL_, testid: 'invite' } });
    await fireEvent.click(screen.getByTestId('invite-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
    expect(showToast).toHaveBeenCalledWith('Link kopiert.', 'success');
  });

  it('reports a missing Clipboard API with the i18n reason', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(InviteLinkQr, { props: { url: URL_, testid: 'invite' } });
    await fireEvent.click(screen.getByTestId('invite-copy'));
    expect(showToast).toHaveBeenCalledWith(
      'Link konnte nicht kopiert werden: Zwischenablage nicht verfügbar',
      'error'
    );
  });
});
