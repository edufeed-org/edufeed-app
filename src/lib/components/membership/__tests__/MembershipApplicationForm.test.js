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

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

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
  getAllLookupRelays: () => ['wss://lookup.example']
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

  beforeEach(() => {
    formEventDelivery.async = false;
    membershipAdmins.list = [ADMIN_PUBKEY];
    membershipForm.address = FORM_ADDRESS;
    timelineState.events = [];
    callOrder.log = [];
    buildSpy.mockClear();
    signSpy.mockClear();
    publishEventSpy.mockClear();
    publishEventSpy.mockImplementation(async () => {
      callOrder.log.push('publish');
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

    await waitFor(() => expect(publishEventSpy).toHaveBeenCalled());

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
    expect(publishEventSpy).not.toHaveBeenCalled();
    expect(eventStoreAddSpy).not.toHaveBeenCalled();
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

    await waitFor(() => expect(publishEventSpy).toHaveBeenCalledTimes(2));

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
    expect(callOrder.log).toEqual(['publish', 'publish', 'add', 'add']);
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

    await waitFor(() => expect(publishEventSpy).toHaveBeenCalled());

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
});
