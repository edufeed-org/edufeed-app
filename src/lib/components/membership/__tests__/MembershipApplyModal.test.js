/** @vitest-environment jsdom */
// The application form as a dialog, opened from the Termi assistant's CTA and
// from the settings card. What matters here is the round trip: the form is
// right there (no settings detour), and a successful submit closes the modal
// so the surface behind it can flip to "waiting for review" in place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const buildSpy = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ tpl) => ({ ...tpl, pubkey: 'user-pub', created_at: 1 }))
);
const signSpy = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ tpl) => ({ ...tpl, id: 'response-id', sig: 'sig' }))
);
const publishEventSpy = vi.hoisted(() => vi.fn(async () => {}));
const publishApplicationCopySpy = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, relays: ['wss://relay.edufeed.org'], successCount: 1 }))
);
const eventStoreAddSpy = vi.hoisted(() => vi.fn());
const closeModalMock = vi.hoisted(() => vi.fn());
const nip44EncryptSpy = vi.hoisted(() =>
  vi.fn(async (/** @type {string} */ _pub, /** @type {string} */ plaintext) => `enc:${plaintext}`)
);

const ADMIN_PUBKEY = 'a'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;

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
      JSON.stringify({ required: true, min: 2, max: 30, pattern: '^[a-z0-9._-]+$' })
    ],
    ['field', 'full_name', 'text', 'Vollständiger Name', '', JSON.stringify({ required: true })],
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

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    get activeModal() {
      return 'membershipApply';
    },
    get modalProps() {
      return {};
    },
    openModal: () => {},
    closeModal: closeModalMock
  }
}));

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
  ensureApplicantRelayLists: async () => {}
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: eventStoreAddSpy,
    replaceable: () => ({
      subscribe(/** @type {(e: any) => void} */ cb) {
        cb(formEvent);
        return { unsubscribe: () => {} };
      }
    }),
    timeline: () => ({
      subscribe(/** @type {(e: any) => void} */ cb) {
        cb([]);
        return { unsubscribe: () => {} };
      }
    })
  },
  pool: {}
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  timedPool: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

// Every loader factory the eager adapter imports reach, not just the one this
// component uses directly — an unmocked export throws at module-eval time and
// takes the whole suite down before a single test runs. Mirrors the sibling
// membership suites.
vi.mock('applesauce-loaders/loaders', () => {
  const noopLoader = () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) });
  return {
    createTimelineLoader: noopLoader,
    createAddressLoader: noopLoader,
    createEventLoader: noopLoader,
    createReactionsLoader: noopLoader
  };
});

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      pubkey: 'user-pub',
      signer: { nip44: { encrypt: nip44EncryptSpy, decrypt: vi.fn() } }
    }
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example'],
  getAllLookupRelays: () => ['wss://lookup.example'],
  // Barrel community loaders + profile/amb-search chain read these at module
  // init, so they must exist even though this suite never calls them.
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
        formAddress: FORM_ADDRESS,
        adminPubkeys: [ADMIN_PUBKEY]
      };
    }
  }
}));

import MembershipApplyModal from '../MembershipApplyModal.svelte';

describe('MembershipApplyModal', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    closeModalMock.mockClear();
    publishEventSpy.mockClear();
    publishApplicationCopySpy.mockClear();
    eventStoreAddSpy.mockClear();
    buildSpy.mockClear();
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(/** @type {any} */ ({ ok: true, json: async () => ({ names: {} }) }));
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  it('renders the application form directly, without a settings detour', async () => {
    const { findByLabelText } = render(MembershipApplyModal);
    expect(await findByLabelText(/Wunsch-Adresse/)).toBeTruthy();
  });

  it('closes on the close button', async () => {
    const { getByTestId } = render(MembershipApplyModal);
    await fireEvent.click(getByTestId('membership-apply-close'));
    expect(closeModalMock).toHaveBeenCalled();
  });

  it('closes itself once the application is published', async () => {
    vi.useFakeTimers();
    const { findByLabelText, findByRole } = render(MembershipApplyModal);
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

    await waitFor(() => expect(publishApplicationCopySpy).toHaveBeenCalled());
    // The event is in the local store before we close, so whatever opened the
    // modal re-renders as "waiting for review" rather than re-offering "apply".
    await waitFor(() => expect(closeModalMock).toHaveBeenCalled());
    expect(eventStoreAddSpy).toHaveBeenCalled();
  });
});
