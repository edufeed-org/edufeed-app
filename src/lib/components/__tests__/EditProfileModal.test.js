/**
 * EditProfileModal tests — sectioned educator profile editing.
 *
 * Own-profile saves go through `actionRunner.run(UpdateProfile, partial)` so
 * applesauce's shallow content merge preserves nip05/lud16/display_name and
 * unknown keys (see updateProfileMergeContract.test.js). Community edits
 * (signer override) still sign directly but merge with the existing profile.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { UpdateProfile } from 'applesauce-actions/actions';

// Shared mocks (hoisted so vi.mock factories can reference them).
const h = vi.hoisted(() => {
  const pub = 'a'.repeat(64);
  const communityPub = 'b'.repeat(64);
  // A PrivateKeySigner-shaped signer: it exposes only async getPublicKey()
  // and signEvent(). Crucially it has NO synchronous `.pubkey` property —
  // exactly like applesauce's PrivateKeySigner / PasswordSigner.
  const signer = {
    getPublicKey: vi.fn(async () => pub),
    signEvent: vi.fn(async (/** @type {any} */ e) => ({ ...e, id: 'signed-id', sig: 'sig' }))
  };
  const communitySigner = {
    getPublicKey: vi.fn(async () => communityPub),
    signEvent: vi.fn(async (/** @type {any} */ e) => ({ ...e, id: 'community-id', sig: 'sig' }))
  };
  return {
    pub,
    communityPub,
    publishEvent: vi.fn(),
    runAction: vi.fn(async () => {}),
    signer,
    communitySigner,
    managerMock: { active: { pubkey: pub, signer } },
    modalStoreMock: {
      modalProps: /** @type {any} */ ({ profile: { name: 'Alice' }, pubkey: pub }),
      activeModal: 'profile',
      closeModal: vi.fn()
    }
  };
});

// Every message key resolves to a function returning the key name, so we can
// assert on specific strings (e.g. section headings, error keys).
vi.mock('$lib/paraglide/messages', async (importOriginal) => {
  const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
  /** @type {Record<string, (params?: any) => string>} */
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
  eventStore: {
    add: vi.fn(),
    replaceable: vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) })),
    timeline: vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) }))
  },
  pool: {}
}));

// action-runner imports app-settings at module level (matchMedia). Mock it and
// capture run() calls for the UpdateProfile assertions.
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: h.runAction },
  actionRunnerOptimistic: { run: vi.fn() },
  factory: {}
}));

// loaders/base touches IndexedDB via event-cache at import time.
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) })),
  eventLoader: vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) })),
  createCachedTimelineLoader: vi.fn(),
  userDeletionLoader: vi.fn()
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => [],
  getEventLoaderLookupRelays: () => [],
  getCommunikeyRelays: () => []
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    blossom: { serverUrl: 'https://blossom.example', maxFileSize: 5 * 1024 * 1024 },
    educational: {}
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

/**
 * Wait until the init effect copied the profile name into the form.
 * @param {HTMLElement} container
 * @param {string} name
 */
async function waitForNameInput(container, name) {
  await waitFor(() => {
    const input = Array.from(container.querySelectorAll('input')).find((i) => i.value === name);
    if (!input) throw new Error('name not initialized');
  });
}

beforeEach(() => {
  cleanup();
  h.publishEvent.mockReset();
  h.publishEvent.mockResolvedValue({ success: true, successCount: 1, relays: ['wss://x'] });
  h.runAction.mockClear();
  h.signer.getPublicKey.mockClear();
  h.signer.signEvent.mockClear();
  h.communitySigner.getPublicKey.mockClear();
  h.communitySigner.signEvent.mockClear();
  h.modalStoreMock.closeModal.mockClear();
  h.modalStoreMock.modalProps = { profile: { name: 'Alice' }, pubkey: h.pub };
});

describe('EditProfileModal save (own profile)', () => {
  it('saves through the UpdateProfile action with the full edufeed object', async () => {
    const { container } = render(EditProfileModal);
    await waitForNameInput(container, 'Alice');

    await fireEvent.click(findButton(container, 'profile_edit_modal_save_button'));

    await waitFor(() => {
      expect(h.runAction).toHaveBeenCalledTimes(1);
    });

    const [action, content] = /** @type {any[]} */ (h.runAction.mock.calls[0]);
    expect(action).toBe(UpdateProfile);
    expect(content).toEqual({
      name: 'Alice',
      about: '',
      picture: '',
      banner: '',
      website: '',
      edufeed: { interests: [], educationalLevels: [], subjects: [] }
    });
    // nip05/lud16/display_name are preserved by the merge, never submitted.
    expect(content).not.toHaveProperty('nip05');
    expect(content).not.toHaveProperty('lud16');
    expect(content).not.toHaveProperty('display_name');

    // No manual kind-0 build for own profiles.
    expect(h.signer.signEvent).not.toHaveBeenCalled();
    expect(h.publishEvent).not.toHaveBeenCalled();

    // Ownership check still resolves via async getPublicKey (no sync .pubkey).
    expect(h.signer.getPublicKey).toHaveBeenCalled();
    expect(container.textContent).not.toContain('profile_edit_modal_error_ownership');
  });

  it('initializes interests from the profile edufeed object and includes edits on save', async () => {
    h.modalStoreMock.modalProps = {
      profile: {
        name: 'Alice',
        edufeed: { interests: ['Klettern'], educationalLevels: [], subjects: [] }
      },
      pubkey: h.pub
    };
    const { container } = render(EditProfileModal);
    await waitForNameInput(container, 'Alice');

    expect(container.textContent).toContain('Klettern');

    const interestsInput = /** @type {HTMLInputElement} */ (
      container.querySelector('input[placeholder="interests_placeholder"]')
    );
    expect(interestsInput).toBeTruthy();
    await fireEvent.input(interestsInput, { target: { value: 'Podcasts' } });
    await fireEvent.keyDown(interestsInput, { key: 'Enter' });

    await fireEvent.click(findButton(container, 'profile_edit_modal_save_button'));
    await waitFor(() => {
      expect(h.runAction).toHaveBeenCalledTimes(1);
    });

    const [, content] = /** @type {any[]} */ (h.runAction.mock.calls[0]);
    expect(content.edufeed.interests).toEqual(['Klettern', 'Podcasts']);
  });

  it('renders sections but no nip05, lightning, or display-name inputs', async () => {
    const { container } = render(EditProfileModal);
    await waitForNameInput(container, 'Alice');

    expect(container.querySelector('#profile-nip05')).toBeNull();
    expect(container.querySelector('#profile-lud16')).toBeNull();
    expect(container.querySelector('#profile-display-name')).toBeNull();
    expect(container.textContent).not.toContain('profile_form_nip05_label');
    expect(container.textContent).not.toContain('profile_form_lightning_label');
    expect(container.textContent).not.toContain('profile_form_display_name_label');

    // Sectioned layout incl. the educator context block.
    expect(container.textContent).toContain('profile_edit_section_who');
    expect(container.textContent).toContain('profile_edit_section_about');
    expect(container.textContent).toContain('profile_edit_section_context');
    expect(container.textContent).toContain('profile_edit_section_website');
    expect(container.textContent).toContain('educator_context_levels_label');
  });
});

describe('EditProfileModal save (community profile via signer override)', () => {
  it('signs directly and preserves unknown fields from the existing profile', async () => {
    h.modalStoreMock.modalProps = {
      profile: { name: 'Comm', lud16: 'zap@example.org', theme: 'blue' },
      pubkey: h.communityPub,
      signer: h.communitySigner
    };
    const { container } = render(EditProfileModal);
    await waitForNameInput(container, 'Comm');

    await fireEvent.click(findButton(container, 'profile_edit_modal_save_button'));

    await waitFor(() => {
      expect(h.publishEvent).toHaveBeenCalledTimes(1);
    });

    expect(h.runAction).not.toHaveBeenCalled();
    const signedEvent = h.publishEvent.mock.calls[0][0];
    expect(signedEvent.kind).toBe(0);
    expect(signedEvent.pubkey).toBe(h.communityPub);
    const content = JSON.parse(signedEvent.content);
    expect(content.name).toBe('Comm');
    expect(content.lud16).toBe('zap@example.org');
    expect(content.theme).toBe('blue');
    // Communities get no educator context section.
    expect(container.textContent).not.toContain('profile_edit_section_context');
  });
});
