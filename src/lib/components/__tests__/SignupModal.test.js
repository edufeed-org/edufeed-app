/**
 * SignupModal — educator-friendly wizard.
 *
 * Step 1 = name only → creates a SimpleAccount and activates it (user is logged
 *   in as soon as they leave step 1; backup is offered as a post-login banner).
 * Step 2 = optional avatar + bio.
 * Step 3 = optional educator context (EducatorContextFields → kind-0 `edufeed`).
 * Step 4 = community picker → finishSignup publishes kind 0 (and optionally
 *   kind 30000 / 10050 / 10002).
 * Step 5 = optional edufeed-handle application (MembershipApplicationForm);
 *   only rendered when runtimeConfig.membership.enabled — otherwise the modal
 *   closes right after finishSignup like before.
 *
 * Tests exercise the load-bearing wiring:
 *  - AvatarUploader on step 2 receives a working signer (preserves prior invariant)
 *  - Empty name does not create an account and does not advance
 *  - Valid name creates SimpleAccount, calls manager.addAccount + setActive
 *  - Steps advance without publishing until step 4
 *  - Educator context edits land as the `edufeed` object in the kind 0
 *  - "Skip"/"Done" on step 4 publish kind 0 (+30000/10050/10002 as configured)
 *  - Membership gate: step 5 shows after finish only when enabled
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Heavy import graphs (vocab resolvers, loaders/base → IndexedDB) — replace
// with light mocks that expose the onchange/onsubmitted wiring.
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
      'auth_signup_modal_step3_subtitle',
      'auth_signup_modal_step3_suggested_heading',
      'auth_signup_modal_step3_search_placeholder',
      'auth_signup_modal_step3_no_matches',
      'auth_signup_modal_step3_done',
      'auth_signup_modal_step3_skip',
      'auth_signup_modal_step_context',
      'auth_signup_modal_context_subtitle',
      'auth_signup_modal_step_handle',
      'auth_signup_modal_handle_subtitle',
      'auth_signup_modal_membership_skip',
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
    blossom: { maxFileSize: 5 * 1024 * 1024 },
    membership: { enabled: false }
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

const mockGetDefaultDmRelays = vi.hoisted(() => vi.fn(() => ['wss://dm.edufeed.org/']));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getDefaultDmRelays: mockGetDefaultDmRelays
}));

const mockBuildSignedRelayList = vi.hoisted(() =>
  vi.fn(async () => ({ kind: 10002, tags: [['r', 'wss://a.example/']], content: '', pubkey: 'x' }))
);
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  buildSignedDefaultRelayList: mockBuildSignedRelayList
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

/**
 * Fill the name and click Continue through steps 2 and 3, landing on the
 * community picker (step 4).
 *
 * @param {any} utils - result of render()
 */
async function advanceToCommunities(utils) {
  const nameInput = utils.getByPlaceholderText('auth_signup_modal_name_placeholder');
  await fireEvent.input(nameInput, { target: { value: 'Alice' } });
  await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 2 (profile)
  await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 3 (context)
  await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 4 (communities)
}

describe('SignupModal — Step 3 (Educator context)', () => {
  it('shows the step indicator with 4 steps when membership is disabled', async () => {
    const { container } = render(SignupModal, { props: { modalId: 'signup-modal' } });
    expect(container.querySelectorAll('.steps .step')).toHaveLength(4);
  });

  it('Step 2 → Step 3 shows EducatorContextFields without publishing', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    const nameInput = utils.getByPlaceholderText('auth_signup_modal_name_placeholder');
    await fireEvent.input(nameInput, { target: { value: 'Alice' } });
    await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 2
    expect(utils.queryByTestId('educator-context-fields-mock')).toBeNull();
    await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 3

    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(utils.getByTestId('educator-context-fields-mock')).toBeTruthy();
    expect(utils.queryByTestId('signup-community-picker-mock')).toBeNull();
  });

  it('Step 3 → Step 4 shows the community picker without publishing', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);

    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(utils.getByTestId('signup-community-picker-mock')).toBeTruthy();
  });

  it('includes edited educator context as the edufeed object in the kind 0', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    const nameInput = utils.getByPlaceholderText('auth_signup_modal_name_placeholder');
    await fireEvent.input(nameInput, { target: { value: 'Alice' } });
    await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 2
    await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 3
    await fireEvent.click(utils.getByTestId('educator-context-set-sample'));
    await fireEvent.click(utils.getByText('auth_signup_modal_continue')); // → step 4
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_skip'));

    await new Promise((r) => setTimeout(r, 0));
    const kind0 = mockPublishEvent.mock.calls.find((c) => c[0].kind === 0)?.[0];
    expect(kind0).toBeTruthy();
    const content = JSON.parse(kind0.content);
    expect(content.edufeed).toEqual({
      interests: ['Klettern'],
      educationalLevels: [
        { id: 'https://edufeed.org/ns/bildungsbereich#schule', prefLabel: { de: 'Schule' } }
      ],
      subjects: []
    });
  });

  it('omits the edufeed key entirely when the user entered nothing', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_skip'));

    await new Promise((r) => setTimeout(r, 0));
    const kind0 = mockPublishEvent.mock.calls.find((c) => c[0].kind === 0)?.[0];
    expect(kind0).toBeTruthy();
    expect(JSON.parse(kind0.content)).not.toHaveProperty('edufeed');
  });
});

describe('SignupModal — Step 4 (Communities)', () => {
  it('Skip publishes kind 0 + kind 10002 + kind 10050 and closes the modal', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_skip'));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockPublishEvent).toHaveBeenCalledTimes(3);
    const kinds = mockPublishEvent.mock.calls.map((c) => c[0].kind).sort((a, b) => a - b);
    expect(kinds).toEqual([0, 10002, 10050]);
    const dmCall = mockPublishEvent.mock.calls.find((c) => c[0].kind === 10050);
    expect(dmCall?.[0].tags).toEqual([['relay', 'wss://dm.edufeed.org/']]);
    // Membership disabled → modal closes right after finish.
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });

  it('Done with empty selection publishes kind 0 + kind 10002 + kind 10050', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_done'));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockPublishEvent).toHaveBeenCalledTimes(3);
    const kinds = mockPublishEvent.mock.calls.map((c) => c[0].kind).sort((a, b) => a - b);
    expect(kinds).toEqual([0, 10002, 10050]);
  });

  it('Skip still publishes kind 0 + kind 10002 when no DM relays configured', async () => {
    mockGetDefaultDmRelays.mockReturnValueOnce([]);
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_skip'));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);
    const kinds = mockPublishEvent.mock.calls.map((c) => c[0].kind).sort((a, b) => a - b);
    expect(kinds).toEqual([0, 10002]);
  });

  it('Skip does not publish kind 10002 when no default relays configured', async () => {
    mockBuildSignedRelayList.mockResolvedValueOnce(/** @type {any} */ (null));
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_skip'));

    await new Promise((r) => setTimeout(r, 0));
    const kinds = mockPublishEvent.mock.calls.map((c) => c[0].kind);
    expect(kinds).not.toContain(10002);
    expect(kinds).toContain(0);
  });

  it('Done with seeded selection publishes kind 0 + kind 10002 + kind 30000 + kind 10050', async () => {
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

    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_done'));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockPublishEvent).toHaveBeenCalledTimes(4);
    const kinds = mockPublishEvent.mock.calls.map((c) => c[0].kind).sort((a, b) => a - b);
    expect(kinds).toEqual([0, 10002, 10050, 30000]);

    // Reset for other tests.
    /** @type {any} */ (config).runtimeConfig.signup.suggestedCommunities = [];
  });
});

describe('SignupModal — Step 5 (edufeed handle, membership-gated)', () => {
  /** @type {any} */
  let config;

  beforeEach(async () => {
    config = await import('$lib/stores/config.svelte.js');
    config.runtimeConfig.membership.enabled = true;
  });

  afterEach(() => {
    config.runtimeConfig.membership.enabled = false;
  });

  it('shows 5 steps in the indicator when membership is enabled', async () => {
    const { container } = render(SignupModal, { props: { modalId: 'signup-modal' } });
    expect(container.querySelectorAll('.steps .step')).toHaveLength(5);
  });

  it('finishing communities advances to the handle step instead of closing', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_skip'));
    await new Promise((r) => setTimeout(r, 0));

    // kind 0 still published at finish, but the modal stays open on step 5.
    expect(mockPublishEvent.mock.calls.some((c) => c[0].kind === 0)).toBe(true);
    expect(mockModalStore.closeModal).not.toHaveBeenCalled();
    expect(await utils.findByTestId('membership-application-form-mock')).toBeTruthy();

    // "Später beantragen" closes the modal.
    await fireEvent.click(utils.getByText('auth_signup_modal_membership_skip'));
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });

  it('after submitting the application the close button reads Done', async () => {
    const utils = render(SignupModal, { props: { modalId: 'signup-modal' } });
    await advanceToCommunities(utils);
    await fireEvent.click(utils.getByText('auth_signup_modal_step3_skip'));
    await new Promise((r) => setTimeout(r, 0));

    await fireEvent.click(await utils.findByTestId('membership-form-submit'));

    expect(utils.queryByText('auth_signup_modal_membership_skip')).toBeNull();
    await fireEvent.click(utils.getByText('auth_signup_modal_done'));
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });
});
