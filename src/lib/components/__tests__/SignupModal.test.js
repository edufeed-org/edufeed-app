/**
 * SignupModal component tests.
 *
 * Covers the load-bearing wiring invariant introduced when keypair generation
 * was hoisted to modal mount: by the time step 2 renders, AvatarUploader must
 * receive a non-null signer with a working signEvent function. A regression
 * (e.g. re-introducing a `currentStep === 3` guard, or dropping the
 * `signer={_signer}` prop) would silently break Blossom uploads on signup.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// jsdom doesn't implement HTMLDialogElement.showModal/close. SignupModal's
// close-handler effect listens for the 'close' event, so emit it from close().
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

// Mock AvatarUploader with a thin stand-in that exposes received props via
// data-* attributes. This is the assertion surface for "signer is wired".
vi.mock('../shared/AvatarUploader.svelte', async () => {
  const mock = await import('./__mocks__/AvatarUploaderMock.svelte');
  return { default: mock.default };
});

// Paraglide messages — stub every key the modal references with a function
// that returns the key as a string. Vitest hoists the factory; we enumerate
// inline rather than reaching for an outer-scope variable.
vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_signup_modal_title',
      'auth_signup_modal_step_introduction',
      'auth_signup_modal_step_profile',
      'auth_signup_modal_step_keys',
      'auth_signup_modal_step_follow',
      'auth_signup_modal_intro_p1',
      'auth_signup_modal_intro_p2',
      'auth_signup_modal_intro_p3',
      'auth_signup_modal_create_profile_title',
      'auth_signup_modal_profile_picture_url',
      'auth_signup_modal_profile_picture_placeholder',
      'auth_signup_modal_profile_picture_hint',
      'auth_signup_modal_name_label',
      'auth_signup_modal_name_placeholder',
      'auth_signup_modal_about_label',
      'auth_signup_modal_about_placeholder',
      'auth_signup_modal_website_label',
      'auth_signup_modal_website_placeholder',
      'auth_signup_modal_keys_title',
      'auth_signup_modal_keys_p1',
      'auth_signup_modal_keys_p2',
      'auth_signup_modal_keys_warning',
      'auth_signup_modal_public_key_label',
      'auth_signup_modal_private_key_download_title',
      'auth_signup_modal_download_nsec',
      'auth_signup_modal_download_ncryptsec',
      'auth_signup_modal_downloaded',
      'auth_signup_modal_encrypted_backup_label',
      'auth_signup_modal_password_placeholder',
      'auth_signup_modal_follow_title',
      'auth_signup_modal_follow_description',
      'auth_signup_modal_selected_count',
      'auth_signup_modal_creating_account',
      'auth_signup_modal_finish',
      'auth_signup_modal_profile_fetch_error',
      'auth_signup_modal_profile_load_failed',
      'common_back',
      'common_cancel',
      'common_next'
    ].map((key) => [key, () => key])
  )
);

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    signup: { suggestedUsers: [] },
    blossom: { maxFileSize: 5 * 1024 * 1024 }
  },
  configReady: { subscribe: () => () => {} }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: null,
    addAccount: vi.fn(),
    setActive: vi.fn()
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    profile: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
  }
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    activeModal: 'signup',
    closeModal: vi.fn()
  }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn()
}));

vi.mock('$lib/helpers/profile.js', () => ({
  fetchProfileData: vi.fn()
}));

// Stub the auto-join helper. The real module is leaf-level now, but stubbing
// keeps this test focused on the signer-wiring invariant.
vi.mock('$lib/helpers/autoJoinCommunities.js', () => ({
  buildAutoJoinFollowSet: vi.fn().mockResolvedValue({ signed: null, targetPubkeys: [] })
}));

// Icon / image stubs — point at an empty real Svelte component so Svelte 5's
// runtime can instantiate them (an inert object isn't callable as a component).
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
});

describe('SignupModal', () => {
  it('passes a non-null signer with a working signEvent to AvatarUploader on step 2', async () => {
    const { container, getByText } = render(SignupModal, {
      props: { modalId: 'signup-test' }
    });

    // Step 1 → step 2 via the Next button. Paraglide stub returns the message
    // key as the text, so the button label is "common_next".
    await fireEvent.click(getByText('common_next'));

    const uploader = container.querySelector('[data-testid="avatar-uploader-mock"]');
    expect(uploader, 'AvatarUploader should render on step 2').not.toBeNull();
    expect(uploader?.getAttribute('data-has-signer')).toBe('true');
    expect(uploader?.getAttribute('data-signer-can-sign')).toBe('true');
  });
});
