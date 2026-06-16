/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

// Shared mocks (hoisted so vi.mock factories can reference them).
const h = vi.hoisted(() => {
  const pub = 'a'.repeat(64);
  // A PrivateKeySigner-shaped signer: it exposes only async getPublicKey()
  // and signEvent(). Crucially it has NO synchronous `.pubkey` property —
  // exactly like applesauce's PrivateKeySigner / PasswordSigner.
  const signer = {
    getPublicKey: vi.fn(async () => pub),
    signEvent: vi.fn(async (/** @type {any} */ e) => ({ ...e, id: 'signed-id', sig: 'sig' }))
  };
  return {
    publishEvent: vi.fn(),
    signer,
    managerMock: { active: { pubkey: pub, signer } },
    modalStoreMock: {
      modalProps: { profile: { name: 'Alice' }, pubkey: pub },
      activeModal: 'profile',
      closeModal: vi.fn()
    }
  };
});

// Every message key resolves to a function returning the key name, so we can
// assert on specific error strings (e.g. the ownership error).
vi.mock('$lib/paraglide/messages', async (importOriginal) => {
  const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
  /** @type {Record<string, () => string>} */
  const mocked = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = () => key;
  }
  return mocked;
});

// app-settings (pulled in transitively via event-factory → LicenseModal) calls
// window.matchMedia at import-time and blows up in jsdom. Short-circuit it.
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (/** @type {any} */ t) => t,
    sign: async (/** @type {any} */ t) => t
  })
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: h.publishEvent,
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() },
  pool: {}
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    blossom: { serverUrl: 'https://blossom.example', maxFileSize: 5 * 1024 * 1024 }
  }
}));

vi.mock('$lib/helpers/upload-and-find-license.js', () => ({
  uploadAndFindLicense: vi.fn()
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: h.managerMock }));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: h.managerMock }));

vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: h.modalStoreMock }));

import EditProfileModal from '../EditProfileModal.svelte';

/**
 * @param {HTMLElement} container
 * @param {string} text
 * @returns {HTMLButtonElement}
 */
function findButton(container, text) {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes(text)
  );
  if (!btn) throw new Error(`button with text "${text}" not found`);
  return /** @type {HTMLButtonElement} */ (btn);
}

beforeEach(() => {
  cleanup();
  h.publishEvent.mockReset();
  h.publishEvent.mockResolvedValue({ success: true, successCount: 1, relays: ['wss://x'] });
  h.signer.getPublicKey.mockClear();
  h.signer.signEvent.mockClear();
  h.modalStoreMock.closeModal.mockClear();
});

describe('EditProfileModal save (own profile)', () => {
  it('signs and publishes when the signer has no synchronous .pubkey (local-key accounts)', async () => {
    const { container } = render(EditProfileModal);

    // Wait for the init effect to copy the profile name into the form.
    await waitFor(() => {
      const input = /** @type {HTMLInputElement | undefined} */ (
        Array.from(container.querySelectorAll('input')).find((i) => i.value === 'Alice')
      );
      if (!input) throw new Error('name not initialized');
    });

    await fireEvent.click(findButton(container, 'profile_edit_modal_save_button'));

    await waitFor(() => {
      expect(h.publishEvent).toHaveBeenCalledTimes(1);
    });

    // The ownership error must NOT be shown.
    expect(container.textContent).not.toContain('profile_edit_modal_error_ownership');
    expect(h.signer.signEvent).toHaveBeenCalled();
  });
});
