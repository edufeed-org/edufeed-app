/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// -----------------------------
// Hoisted spies
// -----------------------------
const buildSpy = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ tpl) => ({
    ...tpl,
    pubkey: 'user-pub',
    created_at: 1
  }))
);
const signSpy = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ tpl) => ({ ...tpl, id: 'response-id', sig: 'sig' }))
);
// Shared call-order log so tests can assert publish/store sequencing.
const callOrder = vi.hoisted(() => ({ log: /** @type {string[]} */ ([]) }));
const publishEventSpy = vi.hoisted(() => vi.fn(async () => {}));
const publishApplicationCopySpy = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ _signedEvent) => ({
    success: true,
    relays: ['wss://relay.edufeed.org'],
    successCount: 1
  }))
);
const ensureApplicantRelayListsSpy = vi.hoisted(() => vi.fn(async () => {}));
const eventStoreAddSpy = vi.hoisted(() => vi.fn());
const nip44EncryptSpy = vi.hoisted(() =>
  vi.fn(async (_pub, plaintext) => `encrypted:${plaintext}`)
);
const nip44DecryptSpy = vi.hoisted(() =>
  vi.fn(async () => JSON.stringify([['response', 'wished_handle', 'maria']]))
);
// When true, the eventStore mock delivers the form event via setTimeout —
// like a first-time relay load (signup wizard) instead of a warm cache hit.
const formEventDelivery = vi.hoisted(() => ({ async: false }));
// Configurable per test: the admin pubkeys / form address exposed by
// runtimeConfig and the user's existing kind 1069 responses returned by
// eventStore.timeline().
const membershipAdmins = vi.hoisted(() => ({ list: /** @type {string[]} */ ([]) }));
const membershipForm = vi.hoisted(() => ({ address: '' }));
const timelineState = vi.hoisted(() => ({ events: /** @type {any[]} */ ([]) }));

const ADMIN_PUBKEY = 'a'.repeat(64);
const ADMIN2_PUBKEY = 'c'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;
const RELAY_HINT = 'wss://hint.example';

// Form template with the 5 expected membership fields
const formEvent = {
  kind: 30168,
  pubkey: ADMIN_PUBKEY,
  created_at: 1,
  id: 'form-id',
  sig: 'sig',
  content: '',
  tags: [
    ['d', 'edufeed-membership'],
    ['name', 'Edufeed.org-Mitgliedschaftsantrag'],
    [
      'field',
      'wished_handle',
      'text',
      'Wunsch-Adresse',
      '',
      JSON.stringify({
        required: true,
        min: 2,
        max: 30,
        pattern: '^[a-z0-9._-]+$',
        placeholder: 'z. B. maria'
      })
    ],
    ['field', 'full_name', 'text', 'Vollständiger Name', '', JSON.stringify({ required: true })],
    ['field', 'affiliation', 'text', 'Institution / Schule', '', JSON.stringify({})],
    ['field', 'role', 'text', 'Rolle', '', JSON.stringify({})],
    [
      'field',
      'motivation',
      'textarea',
      'Warum möchtest du Mitglied von edufeed.org werden?',
      '',
      JSON.stringify({ required: true })
    ]
  ]
};

// -----------------------------
// Module mocks
// -----------------------------
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: buildSpy, sign: signSpy })
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: publishEventSpy,
  buildATagWithHint: async (/** @type {string} */ address) => ['a', address, 'wss://hint.example'],
  buildPTagsWithHints: async (/** @type {string[]} */ pubkeys) =>
    pubkeys.map((pk) => ['p', pk, 'wss://hint.example'])
}));

vi.mock('$lib/services/membership-publish.js', () => ({
  publishApplicationCopy: publishApplicationCopySpy,
  ensureApplicantRelayLists: ensureApplicantRelayListsSpy
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => {
  const replaceable = vi.fn(() => ({
    subscribe(/** @type {(e: any) => void} */ cb) {
      if (formEventDelivery.async) {
        const timer = setTimeout(() => cb(formEvent), 0);
        return { unsubscribe: () => clearTimeout(timer) };
      }
      cb(formEvent);
      return { unsubscribe: () => {} };
    }
  }));
  const timeline = vi.fn(() => ({
    subscribe(/** @type {(e: any) => void} */ cb) {
      cb(timelineState.events);
      return { unsubscribe: () => {} };
    }
  }));
  return {
    eventStore: { add: eventStoreAddSpy, replaceable, timeline, getReplaceable: () => null },
    pool: {}
  };
});

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  timedPool: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

// The new FieldsRenderer field-type registry (form-field-types.js) statically
// imports CreatorFieldAdapter → CreatorInput → profile-subscription.js →
// loaders/profile.js and RelationFieldAdapter → AMBResourceSearchInput →
// loaders/amb-search.js, which (with the barrel) evaluate createAddressLoader/
// createReactionsLoader at module init. Same test-mock-completeness class as
// c640a759 / e0455525 — complete the loader mock so collection succeeds.
// NB: vi.mock is hoisted, so the noop factory must be inlined (no top-level ref).
vi.mock('applesauce-loaders/loaders', () => {
  const noopLoader = () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) });
  return {
    createTimelineLoader: noopLoader,
    createAddressLoader: noopLoader,
    createEventLoader: noopLoader,
    createReactionsLoader: noopLoader
  };
});

// Applesauce/NIP-07 signer shape: NIP-44 lives *only* under the `nip44`
// namespace. Deliberately no flat `nip44Encrypt` — ExtensionSigner does not
// expose one, and assuming it silently downgraded submissions to plaintext.
// Stable object identity: `manager.active` is read inside $effects.
const activeAccount = vi.hoisted(() => ({
  pubkey: 'user-pub',
  signer: /** @type {any} */ (null)
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: activeAccount }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example'],
  getAllLookupRelays: () => ['wss://lookup.example'],
  // Barrel community loaders + profile/amb-search chain read these at module
  // init once the FieldsRenderer registry pulls the new adapters in.
  getArticleRelays: () => [],
  getEducationalRelays: () => [],
  getCalendarRelays: () => [],
  getKanbanRelays: () => [],
  getProfileLookupRelays: () => [],
  getEventLoaderLookupRelays: () => [],
  getFallbackRelays: () => []
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return {
        enabled: true,
        handleDomain: 'edufeed.org',
        formAddress: membershipForm.address,
        adminPubkeys: membershipAdmins.list
      };
    }
  }
}));

import MembershipApplicationForm from '../MembershipApplicationForm.svelte';
// Mocked above — imported to assert on the replaceable() spy.
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

describe('MembershipApplicationForm', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  /**
   * Fill the three required fields and let the handle-availability debounce
   * settle, leaving the form submittable.
   * @param {{ findByLabelText: (m: RegExp) => Promise<HTMLElement> }} screen
   */
  async function fillApplication({ findByLabelText }) {
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
  }

  beforeEach(() => {
    formEventDelivery.async = false;
    membershipAdmins.list = [ADMIN_PUBKEY];
    membershipForm.address = FORM_ADDRESS;
    timelineState.events = [];
    callOrder.log = [];
    buildSpy.mockClear();
    signSpy.mockClear();
    publishEventSpy.mockClear();
    publishApplicationCopySpy.mockClear();
    publishApplicationCopySpy.mockImplementation(async () => {
      callOrder.log.push('publish');
      return { success: true, relays: ['wss://relay.edufeed.org'], successCount: 1 };
    });
    ensureApplicantRelayListsSpy.mockClear();
    ensureApplicantRelayListsSpy.mockImplementation(async () => {
      callOrder.log.push('ensure-relays');
    });
    eventStoreAddSpy.mockClear();
    eventStoreAddSpy.mockImplementation(() => {
      callOrder.log.push('add');
    });
    nip44EncryptSpy.mockClear();
    nip44DecryptSpy.mockClear();
    activeAccount.signer = { nip44: { encrypt: nip44EncryptSpy, decrypt: nip44DecryptSpy } };
    /** @type {any} */ (eventStore).replaceable.mockClear();
    // Default fetch: handle is available (404 / empty names)
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({
        ok: true,
        json: async () => ({ names: {} })
      })
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('renders the 5 membership form fields', async () => {
    const { findByLabelText } = render(MembershipApplicationForm);

    expect(await findByLabelText(/Wunsch-Adresse/)).toBeTruthy();
    expect(await findByLabelText(/Vollständiger Name/)).toBeTruthy();
    expect(await findByLabelText(/Institution \/ Schule/)).toBeTruthy();
    expect(await findByLabelText(/Rolle/)).toBeTruthy();
    expect(await findByLabelText(/Warum möchtest du Mitglied/)).toBeTruthy();
  });

  it('debounces wished_handle input and queries /.well-known/nostr.json', async () => {
    const { findByLabelText } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));

    await fireEvent.input(handleInput, { target: { value: 'maria' } });

    // Before debounce delay → no fetch yet
    expect(fetchSpy).not.toHaveBeenCalled();

    // Advance debounce timer
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('edufeed.org/.well-known/nostr.json');
    expect(url).toContain('name=maria');
  });

  it('shows "taken" status when name is already in nostr.json', async () => {
    fetchSpy.mockResolvedValueOnce(
      /** @type {any} */ ({
        ok: true,
        json: async () => ({ names: { maria: 'somepubkey' } })
      })
    );

    const { findByLabelText, findByText } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(await findByText(/vergeben|taken/i)).toBeTruthy();
  });

  it('shows "available" status when name is not registered', async () => {
    const { findByLabelText, findByText } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));

    await fireEvent.input(handleInput, { target: { value: 'unique-name' } });
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(await findByText(/verfügbar|available/i)).toBeTruthy();
  });

  it('shows availability status when the form event arrives asynchronously (signup wizard first load)', async () => {
    formEventDelivery.async = true;
    const { findByLabelText, findByText } = render(MembershipApplicationForm);

    // Deliver the kind 30168 form event after mount, like a relay would.
    await vi.advanceTimersByTimeAsync(10);

    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(await findByText(/verfügbar|available/i)).toBeTruthy();
  });

  it('publishes encrypted kind 1069 with response tags on submit', async () => {
    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalled());

    expect(buildSpy).toHaveBeenCalled();
    const builtTemplate = buildSpy.mock.calls[0][0];
    expect(builtTemplate.kind).toBe(1069);
    // a-tag → form address
    const aTag = builtTemplate.tags.find((/** @type {string[]} */ t) => t[0] === 'a');
    expect(aTag?.[1]).toBe(FORM_ADDRESS);
    // p-tag → admin pubkey
    const pTag = builtTemplate.tags.find((/** @type {string[]} */ t) => t[0] === 'p');
    expect(pTag?.[1]).toBe(ADMIN_PUBKEY);
    // encryption used
    expect(nip44EncryptSpy).toHaveBeenCalled();
    expect(builtTemplate.tags.some((/** @type {string[]} */ t) => t[0] === 'encrypted')).toBe(true);
    // …and the answers themselves never travel in the clear.
    expect(builtTemplate.tags.some((/** @type {string[]} */ t) => t[0] === 'response')).toBe(false);
    expect(builtTemplate.content).toContain('encrypted:');
    expect(JSON.stringify(builtTemplate.tags)).not.toContain('Maria Mustermann');
  });

  it('refuses to submit rather than publishing answers in the clear', async () => {
    // A signer without NIP-44 at all: the applicant's name, affiliation and
    // motivation must never end up readable on the relay.
    activeAccount.signer = { signEvent: async (/** @type {any} */ e) => e };

    const { findByLabelText, findByRole, findByText } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    expect(await findByText(/NIP-44/)).toBeTruthy();
    expect(publishApplicationCopySpy).not.toHaveBeenCalled();
    expect(eventStoreAddSpy).not.toHaveBeenCalled();
    // Nothing to be reachable for — don't publish relay lists on their behalf.
    expect(ensureApplicantRelayListsSpy).not.toHaveBeenCalled();
  });

  it('publishes one encrypted kind 1069 copy per configured admin', async () => {
    membershipAdmins.list = [ADMIN_PUBKEY, ADMIN2_PUBKEY];

    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalledTimes(2));

    expect(buildSpy).toHaveBeenCalledTimes(2);
    const pTags = buildSpy.mock.calls.map(
      (/** @type {any[]} */ call) =>
        call[0].tags.find((/** @type {string[]} */ t) => t[0] === 'p')?.[1]
    );
    expect(pTags).toEqual([ADMIN_PUBKEY, ADMIN2_PUBKEY]);
    // Each copy is encrypted to its own recipient
    const encryptedTo = nip44EncryptSpy.mock.calls.map((/** @type {any[]} */ call) => call[0]);
    expect(encryptedTo).toEqual([ADMIN_PUBKEY, ADMIN2_PUBKEY]);
    // Both copies carry the form address and the encrypted marker
    for (const call of buildSpy.mock.calls) {
      const tags = call[0].tags;
      expect(tags.find((/** @type {string[]} */ t) => t[0] === 'a')?.[1]).toBe(FORM_ADDRESS);
      expect(tags.some((/** @type {string[]} */ t) => t[0] === 'encrypted')).toBe(true);
    }
    expect(eventStoreAddSpy).toHaveBeenCalledTimes(2);
  });

  it('adds nothing to the event store until every copy has been published', async () => {
    membershipAdmins.list = [ADMIN_PUBKEY, ADMIN2_PUBKEY];

    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    await waitFor(() => expect(eventStoreAddSpy).toHaveBeenCalledTimes(2));

    // Adding a copy to the store mid-loop flips the "existing response" state
    // while the submit is still running — all publishes must complete first.
    expect(callOrder.log).toEqual(['ensure-relays', 'publish', 'publish', 'add', 'add']);
  });

  // The copies used to be published one after another, with a throw on the
  // first failure. That meant the first admin's relays being unreachable
  // stopped the rest from ever being tried, and anything that killed the page
  // mid-loop left admin 1 holding an application admin 2 never saw.
  it('still publishes to the second admin when the first copy fails', async () => {
    membershipAdmins.list = [ADMIN_PUBKEY, ADMIN2_PUBKEY];
    publishApplicationCopySpy.mockImplementation(async () => {
      callOrder.log.push('publish');
      return publishApplicationCopySpy.mock.calls.length === 1
        ? { success: false, relays: [], successCount: 0 }
        : { success: true, relays: ['wss://relay.edufeed.org'], successCount: 1 };
    });

    const { findByLabelText, findByRole, findByText } = render(MembershipApplicationForm);
    await fillApplication({ findByLabelText });
    await fireEvent.click(await findByRole('button', { name: /Antrag|Submit/i }));
    vi.useRealTimers();

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalledTimes(2));
    // One admin has it, so the applicant is genuinely in the queue.
    expect(await findByText(/Wir melden uns|We will be in touch/i)).toBeTruthy();
  });

  it('tells the applicant when only some reviewers were reached', async () => {
    membershipAdmins.list = [ADMIN_PUBKEY, ADMIN2_PUBKEY];
    publishApplicationCopySpy.mockImplementation(async () =>
      publishApplicationCopySpy.mock.calls.length === 1
        ? { success: false, relays: [], successCount: 0 }
        : { success: true, relays: ['wss://relay.edufeed.org'], successCount: 1 }
    );

    const { findByLabelText, findByRole, findByTestId } = render(MembershipApplicationForm);
    await fillApplication({ findByLabelText });
    await fireEvent.click(await findByRole('button', { name: /Antrag|Submit/i }));
    vi.useRealTimers();

    // A clean success message would hide that one reviewer never got it, and
    // the review can only move as fast as the admin who did.
    const notice = await findByTestId('membership-partial-delivery');
    expect(notice.textContent).toMatch(/1/);
  });

  it('mirrors only the copies that actually landed into the event store', async () => {
    membershipAdmins.list = [ADMIN_PUBKEY, ADMIN2_PUBKEY];
    publishApplicationCopySpy.mockImplementation(async () =>
      publishApplicationCopySpy.mock.calls.length === 1
        ? { success: false, relays: [], successCount: 0 }
        : { success: true, relays: ['wss://relay.edufeed.org'], successCount: 1 }
    );

    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    await fillApplication({ findByLabelText });
    await fireEvent.click(await findByRole('button', { name: /Antrag|Submit/i }));
    vi.useRealTimers();

    // A copy no relay accepted does not exist anywhere but here; storing it
    // would show the applicant an application that was never delivered.
    await waitFor(() => expect(eventStoreAddSpy).toHaveBeenCalledTimes(1));
  });

  it('reports a failure when no admin could be reached at all', async () => {
    membershipAdmins.list = [ADMIN_PUBKEY, ADMIN2_PUBKEY];
    publishApplicationCopySpy.mockImplementation(async () => ({
      success: false,
      relays: [],
      successCount: 0
    }));

    const { findByLabelText, findByRole, findByText, queryByText } =
      render(MembershipApplicationForm);
    await fillApplication({ findByLabelText });
    await fireEvent.click(await findByRole('button', { name: /Antrag|Submit/i }));
    vi.useRealTimers();

    expect(await findByText(/konnte nicht gesendet werden|could not be sent/i)).toBeTruthy();
    expect(queryByText(/Wir melden uns|We will be in touch/i)).toBeNull();
    expect(eventStoreAddSpy).not.toHaveBeenCalled();
  });

  it('settles the applicant relay lists before the application goes out', async () => {
    // The approval is answered with a NIP-17 DM. An applicant with no kind
    // 10050 has no inbox for it, and with no kind 10002 nothing about them
    // routes — both must be in place by the time an admin can act.
    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalled());

    expect(ensureApplicantRelayListsSpy).toHaveBeenCalledTimes(1);
    expect(callOrder.log[0]).toBe('ensure-relays');
  });

  it('reports a failure instead of claiming the application was submitted', async () => {
    // The application now goes to a short, app-managed relay list. If none of
    // them took it, "waiting for review" would strand the applicant forever.
    publishApplicationCopySpy.mockImplementation(async () => ({
      success: false,
      relays: [],
      successCount: 0
    }));

    const { findByLabelText, findByRole, findByText, queryByText } =
      render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    await fireEvent.click(await findByRole('button', { name: /Antrag|Submit/i }));
    vi.useRealTimers();

    expect(await findByText(/konnte nicht gesendet werden|could not be sent/i)).toBeTruthy();
    expect(eventStoreAddSpy).not.toHaveBeenCalled();
    expect(queryByText(/Wir melden uns|We will be in touch/i)).toBeNull();
  });

  it('routes the application through the membership publisher, not the outbox model', async () => {
    // publishEvent would fan the application out to the applicant's write
    // relays — the public fallback set for anyone without a kind 10002.
    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalledTimes(1));

    expect(publishEventSpy).not.toHaveBeenCalled();
    expect(publishApplicationCopySpy.mock.calls[0][0]).toMatchObject({ kind: 1069 });
  });

  it('includes relay hints on the a and p tags of each copy', async () => {
    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalled());

    const tags = buildSpy.mock.calls[0][0].tags;
    expect(tags.find((/** @type {string[]} */ t) => t[0] === 'a')?.[2]).toBe(RELAY_HINT);
    expect(tags.find((/** @type {string[]} */ t) => t[0] === 'p')?.[2]).toBe(RELAY_HINT);
  });

  it('keeps colons in the form identifier when loading the template', async () => {
    membershipForm.address = `30168:${ADMIN_PUBKEY}:edufeed:membership:v2`;

    const { findByLabelText } = render(MembershipApplicationForm);
    await findByLabelText(/Wunsch-Adresse/);

    const replaceableSpy = /** @type {import('vitest').Mock} */ (
      /** @type {any} */ (eventStore).replaceable
    );
    expect(replaceableSpy).toHaveBeenCalledWith(30168, ADMIN_PUBKEY, 'edufeed:membership:v2');
  });

  it('loads the form template from the form address author even when admin order changes', async () => {
    membershipAdmins.list = [ADMIN2_PUBKEY, ADMIN_PUBKEY];

    const { findByLabelText } = render(MembershipApplicationForm);
    await findByLabelText(/Wunsch-Adresse/);

    const replaceableSpy = /** @type {import('vitest').Mock} */ (
      /** @type {any} */ (eventStore).replaceable
    );
    expect(replaceableSpy).toHaveBeenCalledWith(30168, ADMIN_PUBKEY, 'edufeed-membership');
  });

  it('decrypts a previous application with the admin it was addressed to', async () => {
    membershipAdmins.list = [ADMIN_PUBKEY, ADMIN2_PUBKEY];
    timelineState.events = [
      {
        kind: 1069,
        id: 'prev-response',
        pubkey: 'user-pub',
        created_at: 1,
        sig: 'sig',
        content: '<ciphertext>',
        tags: [['a', FORM_ADDRESS], ['p', ADMIN2_PUBKEY], ['encrypted']]
      }
    ];

    render(MembershipApplicationForm);
    vi.useRealTimers();

    await waitFor(() =>
      expect(nip44DecryptSpy).toHaveBeenCalledWith(ADMIN2_PUBKEY, '<ciphertext>')
    );
  });

  it('encrypts through a signer that exposes only the flat nip44Encrypt surface', async () => {
    // AmberClipboardSigner, NostrConnectSigner and AndroidNativeSigner all
    // carry a flat nip44Encrypt. They happen to bind it into the nested
    // namespace too, so this is not a portability bug today — but the submit
    // path goes through nip44EncryptWith precisely so that stays true if one
    // of them ever stops binding it, and a guard that only knew about the
    // nested shape would refuse to send at all.
    activeAccount.signer = { nip44Encrypt: nip44EncryptSpy };

    const { findByLabelText, findByRole } = render(MembershipApplicationForm);
    await fillApplication({ findByLabelText });
    await fireEvent.click(await findByRole('button', { name: /Antrag|Submit/i }));
    vi.useRealTimers();

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalled());
    // The flat method itself was reached — a nested-only guard or call would
    // have aborted the submit before this.
    expect(nip44EncryptSpy).toHaveBeenCalled();
    const built = buildSpy.mock.calls[0][0];
    expect(built.tags.some((/** @type {string[]} */ t) => t[0] === 'encrypted')).toBe(true);
    // No plaintext `response` tags: the answers live in content, not tags.
    expect(built.tags.some((/** @type {string[]} */ t) => t[0] === 'response')).toBe(false);
  });

  it('errors instead of publishing plaintext when the signer has no NIP-44 surface', async () => {
    // Signer exposes neither nip44.encrypt nor nip44Encrypt — the old code
    // silently fell back to plaintext response tags here.
    activeAccount.signer = {};

    const { findByLabelText, findByRole, findByText } = render(MembershipApplicationForm);
    const handleInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Wunsch-Adresse/));
    const nameInput = /** @type {HTMLInputElement} */ (await findByLabelText(/Vollständiger Name/));
    const motivationInput = /** @type {HTMLTextAreaElement} */ (
      await findByLabelText(/Warum möchtest du Mitglied/)
    );

    await fireEvent.input(handleInput, { target: { value: 'maria' } });
    await fireEvent.input(nameInput, { target: { value: 'Maria Mustermann' } });
    await fireEvent.input(motivationInput, { target: { value: 'Ich bin Lehrerin und ...' } });

    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    const submitBtn = await findByRole('button', { name: /Antrag|Submit/i });
    await fireEvent.click(submitBtn);
    vi.useRealTimers();

    // A visible error surfaces (nip44EncryptWith's message mentions NIP-44)
    expect(await findByText(/NIP-44/)).toBeTruthy();

    // Nothing was built or published — no plaintext response tags anywhere
    expect(publishEventSpy).not.toHaveBeenCalled();
    expect(eventStoreAddSpy).not.toHaveBeenCalled();
    expect(buildSpy).not.toHaveBeenCalled();
    for (const call of buildSpy.mock.calls) {
      const tpl = /** @type {any} */ (call[0]);
      expect(tpl.tags.some((/** @type {string[]} */ t) => t[0] === 'response')).toBe(false);
    }
  });
});
