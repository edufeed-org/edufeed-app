// @ts-nocheck
/**
 * LoginModal component tests.
 *
 * Covers:
 *  - Extension login branch's duplicate handling
 *  - Restructured normie-friendly layout: saved accounts on top, primary
 *    "Create your account" CTA, then a divider + section with the three
 *    legacy methods all visible (no disclosure to expand).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import LoginModal from '../LoginModal.svelte';

vi.mock('../AccountProfile.svelte', async () => {
  const mock = await import('./__mocks__/AccountProfileMock.svelte');
  return { default: mock.default };
});

const mockExtensionSigner = vi.hoisted(() => ({
  getPublicKey: vi.fn().mockResolvedValue('extension-pk')
}));

vi.mock('applesauce-signers', () => ({
  ExtensionSigner: function ExtensionSigner() {
    return mockExtensionSigner;
  }
}));

// applesauce-accounts/accounts ExtensionAccount class — keep it lightweight,
// just a class that records pubkey + signer so the test can identify the object.
vi.mock('applesauce-accounts/accounts', () => ({
  ExtensionAccount: class ExtensionAccount {
    /**
     * @param {string} pubkey
     * @param {any} signer
     */
    constructor(pubkey, signer) {
      this.id = `ext-${pubkey}`;
      this.pubkey = pubkey;
      this.signer = signer;
    }
  }
}));

const mockManager = vi.hoisted(() => ({
  getAccountForPubkey: vi.fn(),
  addAccount: vi.fn(),
  setActive: vi.fn()
}));

// LoginModal imports both '$lib/stores/accounts.svelte' and
// '$lib/stores/accounts.svelte.js' — Vitest treats them as distinct paths.
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  signer: { signer: null },
  useAccounts: () => () => []
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: mockManager,
  signer: { signer: null },
  useAccounts: () => () => []
}));

// useUserProfile transitively pulls in relay-helper / app-settings (matchMedia).
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => undefined
}));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'login',
  closeModal: vi.fn(),
  openModal: vi.fn()
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: mockModalStore
}));

vi.mock('$lib/paraglide/messages', () => ({
  auth_login_modal_add_account: () => 'Add account',
  auth_login_modal_available_accounts: () => 'Available accounts',
  auth_login_modal_choose_method: () => 'Choose method',
  auth_login_modal_extension: () => 'Extension',
  auth_login_modal_nsec: () => 'NSEC',
  auth_login_modal_bunker: () => 'Bunker',
  auth_login_modal_or: () => 'or',
  auth_login_modal_no_account: () => 'No account?',
  auth_login_modal_create_account_cta: () => 'Create your account',
  auth_login_modal_existing_account: () => 'Already have a Nostr account?',
  auth_login_modal_extension_error_missing: () => 'No browser extension found.',
  auth_login_modal_extension_error_generic: () => 'Could not connect to extension.',
  common_close: () => 'Close',
  auth_login_modal_npub: () => 'Browse with a public key (npub…) — read-only',
  auth_login_modal_extension_short: () => 'Extension',
  auth_login_modal_bunker_short: () => 'Signer app',
  auth_login_modal_nsec_short: () => 'Private key',
  auth_login_modal_npub_short: () => 'Browse only: with public key (npub)'
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockManager.getAccountForPubkey.mockReset();
  mockManager.addAccount.mockReset();
  mockManager.setActive.mockReset();
  mockExtensionSigner.getPublicKey.mockResolvedValue('extension-pk');

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

async function clickExtension(container) {
  // Use data-testid so the test survives future reordering of method buttons.
  const button = container.querySelector('[data-testid="login-method-extension"]');
  await fireEvent.click(/** @type {HTMLElement} */ (button));
  await new Promise((r) => setTimeout(r, 50));
}

describe('LoginModal — Extension flow duplicate handling', () => {
  it('switches to the EXISTING account ref when the extension pubkey is already a known account', async () => {
    const existingAccount = { id: 'existing-id', pubkey: 'extension-pk', signer: {} };
    mockManager.getAccountForPubkey.mockReturnValue(existingAccount);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-1' } });

    await clickExtension(container);

    // Must NOT add a new account
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    // Must call setActive with the EXISTING reference (current code does nothing)
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive.mock.calls[0][0]).toBe(existingAccount);
    // Modal closed
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });

  it('retries getPublicKey once after a "Receiving end does not exist" error (MV3 dormant SW)', async () => {
    // nos2x/Alby on Chrome MV3 commonly fail the very first call after the
    // background service worker idles out, then succeed on retry. Simulate
    // that and assert we recover transparently rather than showing an error.
    const portClosed = new Error(
      'nos2x: Could not establish connection. Receiving end does not exist.'
    );
    mockExtensionSigner.getPublicKey
      .mockRejectedValueOnce(portClosed)
      .mockResolvedValueOnce('extension-pk');
    mockManager.getAccountForPubkey.mockReturnValue(undefined);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-retry-1' } });

    await clickExtension(container);
    // Wait out the 250ms retry delay
    await new Promise((r) => setTimeout(r, 350));

    // No visible error
    const alert = container.querySelector('[data-testid="extension-error"]');
    expect(alert).toBeNull();
    // Account was added on the retry
    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });

  it('surfaces a visible error when the extension is missing instead of hanging silently', async () => {
    // ExtensionMissingError is what applesauce-signers throws when window.nostr
    // is absent. Previously this rejection was unhandled and the modal looked
    // frozen — see the LoginModal createSigner try/catch.
    const err = new Error('Signer extension missing');
    err.name = 'ExtensionMissingError';
    mockExtensionSigner.getPublicKey.mockRejectedValueOnce(err);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-err-1' } });

    await clickExtension(container);

    // Modal stayed open
    expect(mockModalStore.closeModal).not.toHaveBeenCalled();
    // No account was added
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    // Visible error in the section
    const alert = container.querySelector('[data-testid="extension-error"]');
    expect(alert, 'Extension error alert should render').not.toBeNull();
  });

  it('adds and activates a new account on first extension login', async () => {
    mockManager.getAccountForPubkey.mockReturnValue(undefined);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-2' } });

    await clickExtension(container);

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    // The same fresh account object is passed to both
    expect(mockManager.setActive.mock.calls[0][0]).toBe(mockManager.addAccount.mock.calls[0][0]);
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });
});

describe('LoginModal — cleaned-up layout (issue #49)', () => {
  it('shows the primary "Create your account" CTA prominently', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-3' } });

    const cta = container.querySelector('[data-testid="signup-primary-cta"]');
    expect(cta, 'Primary signup CTA should be present').not.toBeNull();
  });

  it('renders the three method cards in a 3-column grid inside the methods section', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-4' } });

    const section = container.querySelector('section[data-testid="other-signin-methods"]');
    expect(section, 'methods section should render').not.toBeNull();

    const grid = section?.querySelector('.grid');
    expect(grid, 'method cards should sit in a grid').not.toBeNull();
    expect(grid?.classList.contains('grid-cols-3')).toBe(true);
    expect(grid?.querySelectorAll('button').length).toBe(3);

    // The old stacked join-group is gone.
    expect(container.querySelector('.join')).toBeNull();
  });

  it('replaces the footer Schließen button with a header close button', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-hdr' } });

    expect(container.querySelector('.modal-action')).toBeNull();

    const close = container.querySelector('[data-testid="login-modal-close"]');
    expect(close, 'header close button should render').not.toBeNull();
    // Inside a method="dialog" form so the native dialog close fires
    // (which the store-sync $effect listens for).
    expect(close?.closest('form')?.getAttribute('method')).toBe('dialog');
  });

  it('renders saved accounts above the primary CTA when present', async () => {
    const accounts = [
      { id: 'acc-1', pubkey: 'p1' },
      { id: 'acc-2', pubkey: 'p2' }
    ];
    const mod = await import('$lib/stores/accounts.svelte.js');
    const original = mod.useAccounts;
    // @ts-ignore
    mod.useAccounts = () => () => accounts;

    try {
      const { container } = render(LoginModal, { props: { modalId: 'login-modal-5' } });

      const savedRows = container.querySelectorAll('[data-testid="saved-account-mock"]');
      expect(savedRows.length).toBe(2);

      const cta = container.querySelector('[data-testid="signup-primary-cta"]');
      expect(cta).not.toBeNull();

      const first = savedRows[0];
      const cmp = first.compareDocumentPosition(/** @type {Node} */ (cta));
      expect(cmp & 4).toBeTruthy();
    } finally {
      // @ts-ignore
      mod.useAccounts = original;
    }
  });

  it('extension card is clickable without expanding anything', async () => {
    mockManager.getAccountForPubkey.mockReturnValue(undefined);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-6' } });

    const extensionButton = container.querySelector('[data-testid="login-method-extension"]');
    await fireEvent.click(/** @type {HTMLElement} */ (extensionButton));
    await new Promise((r) => setTimeout(r, 50));

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
  });
});

describe('LoginModal — mobile extension capability check', () => {
  /** @param {string} ua */
  function stubUserAgent(ua) {
    // jsdom defines userAgent as a prototype getter; an own configurable
    // property shadows it and can be cleanly deleted afterwards.
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  }

  afterEach(() => {
    // @ts-ignore — remove the shadow so the jsdom default returns
    delete window.navigator.userAgent;
    // @ts-ignore
    delete window.nostr;
  });

  it('hides the extension card on a mobile UA without window.nostr', () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-m1' } });

    expect(container.querySelector('[data-testid="login-method-extension"]')).toBeNull();
    const grid = container.querySelector('section[data-testid="other-signin-methods"] .grid');
    expect(grid?.classList.contains('grid-cols-2')).toBe(true);
    expect(grid?.querySelectorAll('button').length).toBe(2);
  });

  it('shows the extension card on a mobile UA when window.nostr is injected', () => {
    stubUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0');
    // @ts-ignore
    window.nostr = {};

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-m2' } });

    expect(container.querySelector('[data-testid="login-method-extension"]')).not.toBeNull();
  });

  it('shows the extension card on a desktop UA without window.nostr', () => {
    // jsdom's default UA contains no mobile marker.
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-m3' } });

    expect(container.querySelector('[data-testid="login-method-extension"]')).not.toBeNull();
  });
});
