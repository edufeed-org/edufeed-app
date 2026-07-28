// @ts-nocheck
/**
 * LoginWithBunker component tests.
 *
 * Focus: when registerBunkerAccount reports the account already exists,
 * the UI must show the friendly info message instead of crashing with the
 * raw "Cant find account with that ID" applesauce error.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import LoginWithBunker from '../LoginWithBunker.svelte';

const mocks = vi.hoisted(() => ({
  registerBunkerAccount: vi.fn(),
  connectWithBunkerUrl: vi.fn(),
  validateBunkerUrl: vi.fn(),
  createClientConnection: vi.fn()
}));

vi.mock('$lib/helpers/bunker-connection.js', () => mocks);

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    getAccountForPubkey: vi.fn(),
    addAccount: vi.fn(),
    setActive: vi.fn()
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {}
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: [], appName: 'TestApp' }
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    activeModal: 'bunker',
    closeModal: vi.fn(),
    openModal: vi.fn()
  }
}));

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock('$lib/paraglide/messages', () => ({
  auth_bunker_auth_open: () => 'Open auth',
  auth_bunker_auth_required: () => 'Auth required',
  auth_bunker_open_in_signer: () => 'Open in signer',
  auth_bunker_open_in_signer_hint: () => 'Hint',
  auth_bunker_qr_description: () => 'Scan QR',
  auth_bunker_qr_regenerate: () => 'Regenerate',
  auth_bunker_status_awaiting_approval: () => 'Awaiting approval',
  auth_bunker_status_awaiting_connection: () => 'Awaiting connection',
  auth_bunker_status_connected: () => 'Connected',
  auth_bunker_status_connecting: () => 'Connecting',
  auth_bunker_status_error: () => 'Error',
  auth_bunker_tab_qr: () => 'QR',
  auth_bunker_tab_url: () => 'URL',
  auth_bunker_title: () => 'Bunker',
  auth_bunker_url_connect: () => 'Connect',
  auth_bunker_url_description: () => 'Paste URL',
  auth_bunker_url_help: () => 'Help',
  auth_bunker_url_label: () => 'Bunker URL',
  auth_bunker_url_placeholder: () => 'bunker://...',
  auth_login_modal_no_account: () => 'No account',
  auth_login_modal_or: () => 'or',
  auth_login_bunker_already_logged_in: () => 'Bunker already logged in',
  bunker_qr_aria: () => 'qr aria',
  common_close: () => 'Close'
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registerBunkerAccount.mockReset();
  mocks.connectWithBunkerUrl.mockReset();
  mocks.validateBunkerUrl.mockReset();
  mocks.createClientConnection.mockReset();

  // The QR-mode $effect auto-runs on mount; give it a never-resolving stub so
  // the URL-mode tests are not racing a real connection.
  mocks.createClientConnection.mockReturnValue({
    signer: { close: vi.fn() },
    uri: 'nostrconnect://stub',
    open: vi.fn().mockResolvedValue(undefined),
    waitForSigner: vi.fn(() => new Promise(() => {}))
  });

  if (typeof HTMLDialogElement !== 'undefined') {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  }
});

/** Switch to the URL tab and submit a stub bunker URL. */
async function submitBunkerUrl(container) {
  // Two radio inputs — the second is the URL tab
  const radios = container.querySelectorAll('input[name="bunker-login-mode"]');
  await fireEvent.change(radios[1]);

  const urlInput = container.querySelector('#bunker-url-input');
  await fireEvent.input(urlInput, { target: { value: 'bunker://stubpubkey?relay=wss://r' } });

  // Submit button is the only btn-primary in URL mode
  const submit = container.querySelector('button.btn-primary');
  await fireEvent.click(submit);

  // Allow the async chain to settle
  await new Promise((r) => setTimeout(r, 50));
}

describe('LoginWithBunker — URL flow duplicate handling', () => {
  it('shows the info message and delays close when bunker account already exists', async () => {
    mocks.validateBunkerUrl.mockReturnValue({ valid: true });
    mocks.connectWithBunkerUrl.mockResolvedValue({
      pubkey: 'existingpubkey',
      signer: { close: vi.fn() }
    });
    mocks.registerBunkerAccount.mockReturnValue({
      account: { id: 'existing-id', pubkey: 'existingpubkey' },
      alreadyExisted: true
    });

    const onAccountCreated = vi.fn();
    const { container, queryByText, findByText } = render(LoginWithBunker, {
      props: { modalId: 'bunker-modal-1', onAccountCreated }
    });

    await submitBunkerUrl(container);

    expect(mocks.registerBunkerAccount).toHaveBeenCalledTimes(1);

    await findByText('Bunker already logged in');
    // Must NOT show the cryptic raw applesauce error
    expect(queryByText('Cant find account with that ID')).toBeNull();
    expect(queryByText(/^Failed to/)).toBeNull();

    // The notice gets its moment on screen BEFORE the flow ends — the parent
    // tears this component down when onAccountCreated fires.
    expect(onAccountCreated).not.toHaveBeenCalled();
    await waitFor(() => expect(onAccountCreated).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it('does not show the info message on the new-account path', async () => {
    mocks.validateBunkerUrl.mockReturnValue({ valid: true });
    mocks.connectWithBunkerUrl.mockResolvedValue({
      pubkey: 'newpubkey',
      signer: { close: vi.fn() }
    });
    mocks.registerBunkerAccount.mockReturnValue({
      account: { id: 'new-id', pubkey: 'newpubkey' },
      alreadyExisted: false
    });

    const onAccountCreated = vi.fn();
    const { container, queryByText } = render(LoginWithBunker, {
      props: { modalId: 'bunker-modal-2', onAccountCreated }
    });

    await submitBunkerUrl(container);

    expect(mocks.registerBunkerAccount).toHaveBeenCalledTimes(1);
    expect(onAccountCreated).toHaveBeenCalledTimes(1);
    expect(queryByText('Bunker already logged in')).toBeNull();
  });
});
