// @ts-nocheck
/**
 * LoginWithNpub — read-only npub login form.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import LoginWithNpub from '../LoginWithNpub.svelte';

const PUBKEY = 'ee11a5dff40c19a555f41fe42b48f00e618c91225622ae37b6c2bb67b76c4e49';
const NPUB = nip19.npubEncode(PUBKEY);

const mockManager = vi.hoisted(() => ({
  getAccountForPubkey: vi.fn(() => null),
  addAccount: vi.fn(),
  setActive: vi.fn()
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'npubLogin',
  openModal: vi.fn(),
  closeModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

vi.mock('$lib/paraglide/messages', () => ({
  auth_login_npub_title: () => 'Browse read-only',
  auth_login_npub_description: () => 'desc',
  auth_login_npub_label: () => 'Public key',
  auth_login_npub_placeholder: () => 'npub1…',
  auth_login_npub_error_invalid: () => 'invalid key',
  auth_login_npub_already_added: () => 'already added',
  auth_login_npub_button: () => 'Browse read-only',
  common_close: () => 'Close'
}));

describe('LoginWithNpub', () => {
  beforeEach(() => {
    mockManager.getAccountForPubkey.mockReset().mockReturnValue(null);
    mockManager.addAccount.mockReset();
    mockManager.setActive.mockReset();
  });

  it('rejects an invalid key with an inline error', async () => {
    const { getByTestId, getByText } = render(LoginWithNpub, { modalId: 't1' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: 'not-a-key' } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(getByText('invalid key')).toBeTruthy();
    expect(mockManager.addAccount).not.toHaveBeenCalled();
  });

  it('adds and activates a ReadonlyAccount for a valid npub', async () => {
    const { getByTestId } = render(LoginWithNpub, { modalId: 't2' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: NPUB } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    const account = mockManager.addAccount.mock.calls[0][0];
    expect(account.type).toBe('readonly');
    expect(account.pubkey).toBe(PUBKEY);
    expect(mockManager.setActive).toHaveBeenCalledWith(account);
  });

  it('accepts a 64-char hex pubkey', async () => {
    const { getByTestId } = render(LoginWithNpub, { modalId: 't3' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: PUBKEY } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
  });

  it('activates the existing account instead of duplicating', async () => {
    const existing = { id: 'x', pubkey: PUBKEY, type: 'readonly' };
    mockManager.getAccountForPubkey.mockReturnValue(existing);
    const { getByTestId, getByText } = render(LoginWithNpub, { modalId: 't4' });
    await fireEvent.input(getByTestId('npub-input'), { target: { value: NPUB } });
    await fireEvent.submit(getByTestId('npub-login-form'));
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    expect(mockManager.setActive).toHaveBeenCalledWith(existing);
    expect(getByText('already added')).toBeTruthy();
  });
});
