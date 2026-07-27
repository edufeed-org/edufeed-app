/**
 * SignupModal — externalSignup mode.
 *
 * When LoginWithGoogle finishes creating a brand-new bunker (Pomegranate)
 * account, it transitions into SignupModal with `{ externalSignup: true }`.
 * In that mode the account already exists and is active in `manager` — the
 * modal must NOT generate a fresh keypair, NOT create a SimpleAccount, and
 * NOT set the `signed-up-here:` flag (that flag drives nsec-backup banners
 * that read `signer.key`, which bunker signers don't have). Instead it
 * adopts `manager.active`'s pubkey + signer.
 *
 * Mock adaptations vs. the task brief:
 *  - Paraglide messages mocked as a plain object (not a Proxy) — this repo's
 *    Vitest 4 setup crashes on Proxy-based paraglide mocks (see
 *    LoginWithNpub.test.js / ReadonlyNotice.test.js precedent).
 *  - Heavy children (AvatarUploader, SignupCommunityPicker,
 *    EducatorContextFields, MembershipApplicationForm) mocked via the
 *    existing `__mocks__/*Mock.svelte` stand-ins used by SignupModal.test.js,
 *    rather than `() => ({})` — a bare function isn't a valid Svelte 5
 *    component and mounting it (step 2 renders AvatarUploader) throws.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const signEvent = vi.fn(async (draft) => ({ ...draft, id: 'x', sig: 'y' }));

const mockManager = vi.hoisted(() => ({
  active: /** @type {any} */ (null),
  addAccount: vi.fn(),
  setActive: vi.fn(),
  getAccountForPubkey: vi.fn(() => null)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

vi.mock('$lib/helpers/signupKeypair.js', () => ({
  generateSignupKeypair: vi.fn(() => {
    throw new Error('must not generate keys in externalSignup mode');
  })
}));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'signup',
  closeModal: vi.fn(),
  openModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    membership: { enabled: false },
    signup: { suggestedCommunities: [] },
    blossom: { maxFileSize: 5 * 1024 * 1024 }
  },
  configReady: { subscribe: () => () => {} }
}));

const mockPublishEvent = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: mockPublishEvent }));

const mockEventStore = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: mockEventStore }));

vi.mock('$lib/loaders/community.js', () => ({
  communikeyTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/communityFollowSet.js', () => ({
  buildCommunityFollowSet: vi.fn().mockResolvedValue({ signed: null, targetPubkeys: [] })
}));
vi.mock('$lib/helpers/dm.js', () => ({ buildDmRelayListEvent: vi.fn(() => ({ kind: 10050 })) }));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getDefaultDmRelays: () => [] }));
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  buildSignedDefaultRelayList: vi.fn(async () => null)
}));

// Heavy children — reuse the repo's existing lightweight stand-ins (see
// SignupModal.test.js) so step 2 (AvatarUploader) can actually mount.
vi.mock('../shared/AvatarUploader.svelte', async () => {
  const mock = await import('./__mocks__/AvatarUploaderMock.svelte');
  return { default: mock.default };
});
vi.mock('../SignupCommunityPicker.svelte', async () => {
  const mock = await import('./__mocks__/SignupCommunityPickerMock.svelte');
  return { default: mock.default };
});
vi.mock('../shared/EducatorContextFields.svelte', async () => {
  const mock = await import('./__mocks__/EducatorContextFieldsMock.svelte');
  return { default: mock.default };
});
vi.mock('../membership/MembershipApplicationForm.svelte', async () => {
  const mock = await import('./__mocks__/MembershipApplicationFormMock.svelte');
  return { default: mock.default };
});

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_signup_modal_title',
      'auth_signup_modal_step1_account',
      'auth_signup_modal_step2_profile',
      'auth_signup_modal_step3_communities',
      'auth_signup_modal_step_context',
      'auth_signup_modal_context_subtitle',
      'auth_signup_modal_step_handle',
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
      'auth_signup_modal_step3_done',
      'auth_signup_modal_step3_skip',
      'auth_signup_modal_creating_account',
      'auth_signup_modal_handle_subtitle',
      'auth_signup_modal_handle_optional_hint',
      'auth_signup_modal_membership_skip',
      'common_back',
      'common_cancel'
    ].map((key) => [key, () => key])
  )
);

import SignupModal from '../SignupModal.svelte';

describe('SignupModal externalSignup mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManager.active = {
      pubkey: 'ab'.repeat(32),
      type: 'nostr-connect',
      signer: { signEvent }
    };
    localStorage.clear();
  });

  it('step 1 advances without creating an account or setting the wizard flag', async () => {
    const { getByLabelText, getByText } = render(SignupModal, {
      modalId: 'sm1',
      externalSignup: true
    });
    await fireEvent.input(getByLabelText('auth_signup_modal_name_label'), {
      target: { value: 'Teacher Tina' }
    });
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await waitFor(() => expect(getByText('auth_signup_modal_step2_subtitle')).toBeTruthy());
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    expect(localStorage.getItem(`signed-up-here:${'ab'.repeat(32)}`)).toBeNull();
  });

  it('adopts the active bunker account pubkey + signer instead of generating a keypair', async () => {
    const { getByLabelText, getByText } = render(SignupModal, {
      modalId: 'sm2',
      externalSignup: true
    });
    await fireEvent.input(getByLabelText('auth_signup_modal_name_label'), {
      target: { value: 'Teacher Tina' }
    });
    await fireEvent.click(getByText('auth_signup_modal_continue'));
    await waitFor(() => expect(getByText('auth_signup_modal_step2_subtitle')).toBeTruthy());

    // AvatarUploader (step 2) received the adopted signer.
    const uploader = document.querySelector('[data-testid="avatar-uploader-mock"]');
    expect(uploader?.getAttribute('data-has-signer')).toBe('true');
    expect(uploader?.getAttribute('data-signer-can-sign')).toBe('true');
  });
});
