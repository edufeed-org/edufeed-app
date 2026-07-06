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
const publishEventSpy = vi.hoisted(() => vi.fn(async () => {}));
const eventStoreAddSpy = vi.hoisted(() => vi.fn());
const nip44EncryptSpy = vi.hoisted(() =>
  vi.fn(async (_pub, plaintext) => `encrypted:${plaintext}`)
);
// When true, the eventStore mock delivers the form event via setTimeout —
// like a first-time relay load (signup wizard) instead of a warm cache hit.
const formEventDelivery = vi.hoisted(() => ({ async: false }));

const ADMIN_PUBKEY = 'a'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;

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
  publishEvent: publishEventSpy
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
      cb([]);
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

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      pubkey: 'user-pub',
      signer: {
        nip44Encrypt: nip44EncryptSpy
      }
    }
  }
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
        formAddress: FORM_ADDRESS,
        adminPubkeys: [ADMIN_PUBKEY]
      };
    }
  }
}));

import MembershipApplicationForm from '../MembershipApplicationForm.svelte';

describe('MembershipApplicationForm', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    formEventDelivery.async = false;
    buildSpy.mockClear();
    signSpy.mockClear();
    publishEventSpy.mockClear();
    eventStoreAddSpy.mockClear();
    nip44EncryptSpy.mockClear();
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
  });
});
