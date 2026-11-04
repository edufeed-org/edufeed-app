// @ts-nocheck
/**
 * ProfileQrModal — a profile's QR code plus the scanner that opens other
 * profiles from theirs (issue 9f7816e3).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

const spies = vi.hoisted(() => ({
  goto: vi.fn(),
  showToast: vi.fn(),
  toDataURL: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: spies.goto }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: spies.showToast }));
vi.mock('$lib/helpers/toast', () => ({ showToast: spies.showToast }));
vi.mock('qrcode', () => ({ default: { toDataURL: spies.toDataURL } }));
vi.mock('../profile/QrScanner.svelte', async () => {
  const mock = await import('./__mocks__/QrScannerStub.svelte');
  return { default: mock.default };
});
vi.mock('../shared/ProfileAvatar.svelte', async () => {
  const { default: Stub } = await import('./fixtures/StubComponent.svelte');
  return { default: Stub };
});
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => ({ name: 'Musterfrau' })
}));

import ProfileQrModal from '../profile/ProfileQrModal.svelte';

const HEX = 'a'.repeat(64);
const NPUB = nip19.npubEncode(HEX);
const OTHER_NPUB = nip19.npubEncode('b'.repeat(64));

beforeEach(() => {
  spies.goto.mockReset();
  spies.showToast.mockReset();
  spies.toDataURL.mockReset().mockResolvedValue('data:image/png;base64,QR');
  delete globalThis.__qrScanPayload;
});

function renderModal(overrides = {}) {
  const onClose = vi.fn();
  const utils = render(ProfileQrModal, { pubkey: HEX, npub: NPUB, onClose, ...overrides });
  return { onClose, ...utils };
}

describe('<ProfileQrModal> show mode', () => {
  it('renders the QR code of the nostr: profile URI with the name and the npub', async () => {
    const { findByTestId, getByText } = renderModal();
    const img = await findByTestId('profile-qr-image');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QR');
    expect(spies.toDataURL).toHaveBeenCalledWith(`nostr:${NPUB}`, expect.any(Object));
    expect(getByText('Musterfrau')).toBeTruthy();
    expect(getByText(NPUB)).toBeTruthy();
  });

  it('copies the npub', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { findByTestId } = renderModal();
    await fireEvent.click(await findByTestId('profile-qr-copy'));
    expect(writeText).toHaveBeenCalledWith(NPUB);
  });

  it('takes focus so Escape closes it, and closes on the close button', async () => {
    const { onClose, findByTestId } = renderModal();
    const modal = await findByTestId('profile-qr-modal');
    await waitFor(() => expect(modal.contains(document.activeElement)).toBe(true));
    await fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent.click(await findByTestId('profile-qr-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('<ProfileQrModal> scan mode', () => {
  it('switches to the scanner and back', async () => {
    const { findByTestId, queryByTestId } = renderModal();
    await fireEvent.click(await findByTestId('profile-qr-scan'));
    expect(await findByTestId('scanner-stub')).toBeTruthy();
    expect(queryByTestId('profile-qr-image')).toBeNull();
    await fireEvent.click(await findByTestId('scanner-cancel'));
    expect(await findByTestId('profile-qr-image')).toBeTruthy();
  });

  it('opens the scanned profile and closes the modal', async () => {
    globalThis.__qrScanPayload = `nostr:${OTHER_NPUB}`;
    const { onClose, findByTestId } = renderModal();
    await fireEvent.click(await findByTestId('profile-qr-scan'));
    await fireEvent.click(await findByTestId('scanner-emit'));
    expect((await findByTestId('scanner-stub')).dataset.handled).toBe('true');
    expect(spies.goto).toHaveBeenCalledWith(`/p/${OTHER_NPUB}`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning after a code that is no Nostr profile, with an error toast', async () => {
    globalThis.__qrScanPayload = 'WIFI:S:home;;';
    const { onClose, findByTestId } = renderModal();
    await fireEvent.click(await findByTestId('profile-qr-scan'));
    await fireEvent.click(await findByTestId('scanner-emit'));
    expect((await findByTestId('scanner-stub')).dataset.handled).toBe('false');
    expect(spies.goto).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(spies.showToast).toHaveBeenCalledWith(expect.any(String), 'error'));
  });

  it('refuses a private key with its own warning', async () => {
    globalThis.__qrScanPayload = `nostr:${nip19.nsecEncode(new Uint8Array(32).fill(1))}`;
    const { findByTestId } = renderModal();
    await fireEvent.click(await findByTestId('profile-qr-scan'));
    await fireEvent.click(await findByTestId('scanner-emit'));
    expect(spies.goto).not.toHaveBeenCalled();
    const [[message, type]] = spies.showToast.mock.calls;
    expect(type).toBe('error');
    expect(message).toMatch(/privat|private/i);
  });
});
