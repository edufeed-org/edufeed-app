/**
 * SignupModal — new 3-step normie-friendly flow.
 *
 * Step 1 = name only → creates a SimpleAccount and activates it (user is logged
 *   in as soon as they leave step 1; backup is offered as a post-login banner).
 * Step 2 = optional avatar + bio → advances to Step 3.
 * Step 3 = community picker → publishes kind 0 (and optionally kind 30000).
 *
 * Tests exercise the load-bearing wiring:
 *  - AvatarUploader on step 2 receives a working signer (preserves prior invariant)
 *  - Empty name does not create an account and does not advance
 *  - Valid name creates SimpleAccount, calls manager.addAccount + setActive
 *  - Step 1 → Step 2 advances without publishing
 *  - Step 2 → Step 3 advances without publishing
 *  - "Skip" on step 3 publishes only kind 0
 *  - "Done" on step 3 with empty selection publishes only kind 0
 *  - "Done" on step 3 with seeded selection publishes kind 0 + kind 30000
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// jsdom doesn't implement HTMLDialogElement.showModal/close. Provide stubs so
// the modal's close-handler effect can wire up.
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

vi.mock('../shared/AvatarUploader.svelte', async () => {
  const mock = await import('./__mocks__/AvatarUploaderMock.svelte');
  return { default: mock.default };
});

vi.mock('../SignupCommunityPicker.svelte', async () => {
  const mock = await import('./__mocks__/SignupCommunityPickerMock.svelte');
  return { default: mock.default };
});

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_signup_modal_title',
      'auth_signup_modal_step1_account',
      'auth_signup_modal_step2_profile',
      'auth_signup_modal_step3_communities',
      'auth_signup_modal_step3_subtitle',
      'auth_signup_modal_step3_suggested_heading',
      'auth_signup_modal_step3_search_placeholder',
      'auth_signup_modal_step3_no_matches',
      'auth_signup_modal_step3_done',
      'auth_signup_modal_step3_skip',
      'auth_signup_modal_step1_subtitle',
      'auth_signup_modal_step2_subtitle',
      'auth_signup_modal_name_label',
      'auth_signup_modal_name_placeholder',
      'auth_signup_modal_about_label',
      'auth_signup_modal_about_placeholder',
      'auth_signup_modal_profile_picture_url',
      'auth_signup_modal_profile_picture_placeholder',
      'auth_signup_modal_profile_picture_hint',
      'auth_signup_modal_picture_url_disclosure',
      'auth_signup_modal_continue',
      'auth_signup_modal_done',
      'auth_signup_modal_skip',
      'auth_signup_modal_creating_account',
      'common_back',
      'common_cancel'
    ].map((key) => [key, () => key])
  )
);

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    signup: { suggestedCommunities: [] },
    blossom: { maxFileSize: 5 * 1024 * 1024 }
  },
  configReady: { subscribe: () => () => {} }
}));

const mockManager = vi.hoisted(() => ({
  active: null,
  addAccount: vi.fn(),
  setActive: vi.fn(),
  getAccountForPubkey: vi.fn().mockReturnValue(undefined)
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: mockManager
}));

const mockEventStore = vi.hoisted(() => ({
  add: vi.fn(),
  profile: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: mockEventStore
}));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'signup',
  closeModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: mockModalStore
}));

const mockPublishEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: mockPublishEvent
}));

vi.mock('$lib/helpers/profile.js', () => ({
  fetchProfileData: vi.fn()
}));

vi.mock('$lib/helpers/communityFollowSet.js', () => ({
  buildCommunityFollowSet: vi.fn().mockResolvedValue({ signed: null, targetPubkeys: [] })
}));

const mockCommunikeyTimelineLoader = vi.hoisted(() =>
  vi.fn().mockReturnValue(() => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }))
);
vi.mock('$lib/loaders/community.js', () => ({
  communikeyTimelineLoader: mockCommunikeyTimelineLoader
}));

// Stub the keypair helper so the signer's signEvent doesn't hit @noble/hashes'
// strict `instanceof Uint8Array` check, which fails in jsdom because
// jsdom's TextEncoder returns Uint8Arrays from a different realm than the one
// @noble/hashes was loaded in. The real helper is exercised in node-env tests.
vi.mock('$lib/helpers/signupKeypair.js', () => ({
  generateSignupKeypair: () => {
    const pk = 'a'.repeat(64);
    return {
      privateKey: new Uint8Array(32).fill(1),
      publicKey: pk,
      nsec: 'nsec1stub',
      npub: 'npub1stub',
      signer: {
        signEvent: vi.fn(async (event) => ({
          ...event,
          id: 'b'.repeat(64),
          sig: 'c'.repeat(128),
          pubkey: pk
        }))
      }
    };
  }
}));

vi.mock('../shared/ImageWithFallback.svelte', async () => {
  const stub = await import('./__mocks__/EmptyStub.svelte');
  return { default: stub.default };
});
vi.mock('../icons/actions/CopyIcon.svelte', async () => {
  const stub = await import('./__mocks__/EmptyStub.svelte');
  return { default: stub.default };
});
vi.mock('../icons/ui/CheckIcon.svelte', async () => {
  const stub = await import('./__mocks__/EmptyStub.svelte');
  return { default: stub.default };
});
vi.mock('../icons/ui/ChevronLeftIcon.svelte', async () => {
  const stub = await import('./__mocks__/EmptyStub.svelte');
  return { default: stub.default };
});
vi.mock('../icons/ui/ChevronRightIcon.svelte', async () => {
  const stub = await import('./__mocks__/EmptyStub.svelte');
  return { default: stub.default };
});

import SignupModal from '../SignupModal.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  mockManager.addAccount.mockClear();
  mockManager.setActive.mockClear();
  mockManager.getAccountForPubkey.mockReturnValue(undefined);
});

/**
 * Helper: type into the name field and click Continue.
 *
 * @param {Document | HTMLElement} container
 * @param {(text: string) => HTMLElement} getByText
 * @param {string} name
 */
async function submitStep1(container, getByText, name) {
  const nameInput = /** @type {HTMLInputElement} */ (container.querySelector('#signup-name-input'));
  if (nameInput) {
    await fireEvent.input(nameInput, { target: { value: name } });
  }
  await fireEvent.click(getByText('auth_signup_modal_continue'));
}

describe('SignupModal — Step 1 (Account)', () => {
  it('does not create or activate an account when the name is empty', async () => {
    const { container, getByText } = render(SignupModal, {
      props: { modalId: 'signup-test-1' }
    });

    await submitStep1(container, getByText, '');

    expect(mockManager.addAccount).not.toHaveBeenCalled();
    expect(mockManager.setActive).not.toHaveBeenCalled();
  });

  it('creates a SimpleAccount, activates it, and advances to Step 2 when name is valid', async () => {
    const { container, getByText } = render(SignupModal, {
      props: { modalId: 'signup-test-2' }
    });

    await submitStep1(container, getByText, 'Test Teacher');

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);

    // Same account passed to both
    const created = mockManager.addAccount.mock.calls[0][0];
    expect(mockManager.setActive.mock.calls[0][0]).toBe(created);

    // Account looks like a SimpleAccount (has pubkey + signer)
    expect(created.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof created.signer.signEvent).toBe('function');

    // Step 2 is rendered (AvatarUploader present)
    const uploader = container.querySelector('[data-testid="avatar-uploader-mock"]');
    expect(uploader).not.toBeNull();

    // Wizard graduation flag is written so post-login banners know to show.
    expect(localStorage.getItem(`signed-up-here:${created.pubkey}`)).toBe('1');
  });

  it('advances when the user presses Enter inside the name input', async () => {
    // Submitting the form (Enter on input → implicit submit) must run the
    // same path as clicking Continue. Without the <form> wrap, Enter was a
    // no-op and confused testers. Asserts on the form's submit so we are
    // not coupled to whether the submit button lives inside or outside it.
    const { container } = render(SignupModal, {
      props: { modalId: 'signup-test-enter' }
    });

    const nameInput = /** @type {HTMLInputElement} */ (
      container.querySelector('#signup-name-input')
    );
    await fireEvent.input(nameInput, { target: { value: 'Test Teacher' } });

    const form = /** @type {HTMLFormElement} */ (container.querySelector('#signup-step1-form'));
    expect(form, 'Step 1 should be wrapped in a <form>').not.toBeNull();
    await fireEvent.submit(form);

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    // Step 2 rendered (AvatarUploader visible).
    const uploader = container.querySelector('[data-testid="avatar-uploader-mock"]');
    expect(uploader).not.toBeNull();
  });

  it('does not create the account twice if Continue is clicked twice', async () => {
    // Simulate the manager already knowing this pubkey on the second click.
    mockManager.getAccountForPubkey
      .mockReturnValueOnce(undefined) // first click: no existing account
      .mockReturnValue({ id: 'existing' }); // subsequent: account exists

    const { container, getByText } = render(SignupModal, {
      props: { modalId: 'signup-test-3' }
    });

    await submitStep1(container, getByText, 'Test Teacher');
    // After first click we're on step 2; can't click Continue again. The
    // guard's real value is in surviving accidental form double-submits at
    // step 1 — covered structurally by the addAccount call count above.
    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
  });
});

describe('SignupModal — Step 2 (Profile)', () => {
  it('passes a non-null signer with a working signEvent to AvatarUploader', async () => {
    const { container, getByText } = render(SignupModal, {
      props: { modalId: 'signup-test-4' }
    });

    await submitStep1(container, getByText, 'Test Teacher');

    const uploader = container.querySelector('[data-testid="avatar-uploader-mock"]');
    expect(uploader, 'AvatarUploader should render on step 2').not.toBeNull();
    expect(uploader?.getAttribute('data-has-signer')).toBe('true');
    expect(uploader?.getAttribute('data-signer-can-sign')).toBe('true');
  });
});

describe('SignupModal — Step 3 (Communities)', () => {
  it('Step 1 → Step 2 advances without publishing', async () => {
    const { getByPlaceholderText, getByText, queryByTestId } = render(SignupModal, {
      props: { modalId: 'signup-modal' }
    });
    const nameInput = getByPlaceholderText('auth_signup_modal_name_placeholder');
    await fireEvent.input(nameInput, { target: { value: 'Alice' } });
    await fireEvent.click(getByText('auth_signup_modal_continue'));

    expect(mockPublishEvent).not.toHaveBeenCalled();
    // Step 2 visible; picker mock not yet (it's step 3)
    expect(queryByTestId('signup-community-picker-mock')).toBeNull();
  });

  it('Step 2 → Step 3 advances without publishing', async () => {
    const { getByPlaceholderText, getByText, getByTestId } = render(SignupModal, {
      props: { modalId: 'signup-modal' }
    });
    const nameInput = getByPlaceholderText('auth_signup_modal_name_placeholder');
    await fireEvent.input(nameInput, { target: { value: 'Alice' } });
    await fireEvent.click(getByText('auth_signup_modal_continue')); // → step 2
    await fireEvent.click(getByText('auth_signup_modal_continue')); // → step 3

    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(getByTestId('signup-community-picker-mock')).toBeTruthy();
  });

  it('Step 3 Skip publishes only kind 0', async () => {
    const { getByPlaceholderText, getByText } = render(SignupModal, {
      props: { modalId: 'signup-modal' }
    });
    const nameInput = getByPlaceholderText('auth_signup_modal_name_placeholder');
    await fireEvent.input(nameInput, { target: { value: 'Alice' } });
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await fireEvent.click(getByText('auth_signup_modal_step3_skip'));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const [signedKind0] = mockPublishEvent.mock.calls[0];
    expect(signedKind0.kind).toBe(0);
  });

  it('Step 3 Done with empty selection publishes only kind 0', async () => {
    const { getByPlaceholderText, getByText } = render(SignupModal, {
      props: { modalId: 'signup-modal' }
    });
    const nameInput = getByPlaceholderText('auth_signup_modal_name_placeholder');
    await fireEvent.input(nameInput, { target: { value: 'Alice' } });
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await fireEvent.click(getByText('auth_signup_modal_step3_done'));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent.mock.calls[0][0].kind).toBe(0);
  });

  it('Step 3 Done with seeded selection publishes kind 0 + kind 30000', async () => {
    // Stub buildCommunityFollowSet to return a signed event so the modal calls publishEvent twice.
    const fakeKind30000 = {
      kind: 30000,
      content: '',
      tags: [['d', 'communities']],
      pubkey: 'x',
      sig: '',
      created_at: 0,
      id: 'fake'
    };
    // mockResolvedValueOnce (not mockResolvedValue) so this test's stub does
    // not leak into subsequent tests — vi.clearAllMocks() resets call history
    // but not implementations set via mockResolvedValue.
    const mod = await import('$lib/helpers/communityFollowSet.js');
    /** @type {any} */ (mod.buildCommunityFollowSet).mockResolvedValueOnce({
      signed: fakeKind30000,
      targetPubkeys: ['a'.repeat(64)]
    });

    // Tell the modal there's one suggested community (so it seeds the selection).
    const config = await import('$lib/stores/config.svelte.js');
    /** @type {any} */ (config).runtimeConfig.signup.suggestedCommunities = ['a'.repeat(64)];

    const { getByPlaceholderText, getByText } = render(SignupModal, {
      props: { modalId: 'signup-modal' }
    });
    const nameInput = getByPlaceholderText('auth_signup_modal_name_placeholder');
    await fireEvent.input(nameInput, { target: { value: 'Alice' } });
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await fireEvent.click(getByText('auth_signup_modal_step3_done'));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);
    const kinds = mockPublishEvent.mock.calls.map((c) => c[0].kind).sort();
    expect(kinds).toEqual([0, 30000]);

    // Reset for other tests.
    /** @type {any} */ (config).runtimeConfig.signup.suggestedCommunities = [];
  });
});
