/** @vitest-environment jsdom */
/**
 * FormResponses for a calendar form (settings.output = nip52-calendar), with
 * the WordPress plugin's fixtures: the community's response list decrypts an
 * anonymous one-time-key response, shows its responder as "Anonym", and
 * "Als Termin übernehmen" opens CalendarEventModal prefilled with the draft
 * the wiki's worked example publishes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// jsdom's import.meta.url is not a file URL; tests run from the repo root.
const dir = resolve('src/lib/__tests__/fixtures/calendar-forms') + '/';

const h = vi.hoisted(() => ({
  /** @type {any} */ copy: null,
  /** @type {any} */ response: null,
  /** @type {any} */ signer: null,
  /** @type {any} */ communityEvent: null,
  /** @type {Map<string, any>} */ profiles: new Map(),
  openModal: /** @type {any} */ (null),
  /** @type {any[]} */ concepts: []
}));
h.openModal = vi.fn();

h.copy = JSON.parse(readFileSync(dir + 'community-copy.json', 'utf8'));
h.response = JSON.parse(readFileSync(dir + 'response-worked-example.json', 'utf8'));
const { PrivateKeySigner } = await import('applesauce-signers');
const { hexToBytes } = await import('nostr-tools/utils');
h.signer = new PrivateKeySigner(
  hexToBytes(readFileSync(dir + 'THROWAWAY-community-secret.hex', 'utf8').trim())
);

const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';
h.concepts = [
  {
    kind: 39738,
    pubkey: 'd'.repeat(64),
    created_at: 1,
    id: 'concept-c',
    sig: '',
    content: '',
    tags: [
      ['d', 'level_C'],
      ['i', LEVEL_C],
      ['prefLabel', 'Advanced training', 'en'],
      ['prefLabel', 'Fortbildung', 'de']
    ]
  }
];

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ url: new URL('http://localhost/forms/x') }) };
});
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return { pubkey: h.copy.pubkey, signer: h.signer };
    }
  }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({
      subscribe: (/** @type {(v: any) => void} */ cb) => {
        cb([h.response]);
        return { unsubscribe: () => {} };
      }
    }),
    replaceable: () => ({
      subscribe: (/** @type {(v: any) => void} */ cb) => {
        cb(h.communityEvent);
        return { unsubscribe: () => {} };
      }
    })
  }
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...a) => h.openModal(...a) }
}));
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useSchemeConcepts: () => () => h.concepts
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({ actionRunner: { run: vi.fn() } }));
vi.mock('$lib/helpers/community-signer.js', () => ({ getCommunitySigner: () => null }));
vi.mock('$lib/helpers/communityRelays.js', () => ({ parseCommunityContentTypes: () => [] }));
vi.mock('$lib/loaders/community.js', () => ({
  formResponseLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => [],
  getAllLookupRelays: () => []
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => h.profiles }));
vi.mock('$lib/helpers/dates.js', () => ({ formatTimestamp: () => '1 Jan' }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pk) => `/p/${pk}`
}));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: function Stub() {} }));

const m = await import('$lib/paraglide/messages');
const { default: FormResponses } = await import('$lib/components/forms/FormResponses.svelte');

const formAddress = `30168:${h.copy.pubkey}:edufeed-calendar-event`;

beforeEach(() => {
  h.openModal.mockClear();
  h.communityEvent = null;
  h.profiles = new Map();
});

async function expand() {
  render(FormResponses, { props: { formEvent: h.copy, formAddress } });
  await fireEvent.click(await screen.findByRole('button', { name: /Anonym|Jane/ }));
  await waitFor(() => expect(screen.getByText('OER-Werkstatt')).toBeTruthy());
}

describe('FormResponses — calendar form', () => {
  it('decrypts the one-time-key response and names its responder "Anonym"', async () => {
    await expand();
    expect(screen.getAllByText(m.form_responses_anonymous()).length).toBeGreaterThan(0);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it('shows a responder with a profile by name', async () => {
    h.profiles = new Map([[h.response.pubkey, { name: 'Jane' }]]);
    render(FormResponses, { props: { formEvent: h.copy, formAddress } });
    expect(await screen.findByText('Jane')).toBeTruthy();
    expect(screen.queryByText(m.form_responses_anonymous())).toBeNull();
  });

  it('opens the event modal prefilled with the worked-example draft', async () => {
    await expand();
    await fireEvent.click(screen.getByRole('button', { name: m.form_responses_to_calendar() }));
    expect(h.openModal).toHaveBeenCalledTimes(1);
    const [type, props] = h.openModal.mock.calls[0];
    expect(type).toBe('calendarEvent');
    expect(props).toEqual({
      mode: 'create',
      communityPubkey: '',
      prefillDraft: {
        kind: 31923,
        content: '',
        tags: [
          ['title', 'OER-Werkstatt'],
          ['start', '1795179600'],
          ['end', '1795186800'],
          ['start_tzid', 'Europe/Berlin'],
          ['end_tzid', 'Europe/Berlin'],
          ['D', '20777'],
          ['participant', 'Jane Doe', '', 'speaker'],
          ['eventAttendanceMode', 'https://schema.org/OnlineEventAttendanceMode'],
          ['educationalLevel:id', LEVEL_C],
          ['educationalLevel:prefLabel:de', 'Fortbildung'],
          ['educationalLevel:prefLabel:en', 'Advanced training'],
          ['educationalLevel:type', 'Concept']
        ]
      }
    });
  });

  it('targets the form author as community when it has a community definition', async () => {
    h.communityEvent = { kind: 10222, pubkey: h.copy.pubkey, tags: [], content: '' };
    await expand();
    await fireEvent.click(screen.getByRole('button', { name: m.form_responses_to_calendar() }));
    expect(h.openModal.mock.calls[0][1].communityPubkey).toBe(h.copy.pubkey);
  });

  it('says why a response cannot become an event instead of opening the modal', async () => {
    // The response leaves the time zone to the field's default; make that
    // default an unknown zone.
    const formEvent = {
      ...h.copy,
      tags: h.copy.tags.map((/** @type {string[]} */ t) =>
        t[0] === 'field' && t[1] === 'tzid'
          ? [...t.slice(0, 5), '{"renderElement":"text","defaultValue":"Mars/Olympus"}']
          : t
      )
    };
    render(FormResponses, { props: { formEvent, formAddress } });
    await fireEvent.click(await screen.findByRole('button', { name: /Anonym/ }));
    await waitFor(() => expect(screen.getByText('OER-Werkstatt')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: m.form_responses_to_calendar() }));
    expect(h.openModal).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      m.form_responses_to_calendar_invalid({ field: 'Zeitzone' })
    );
  });

  it('offers no calendar action on a form without the calendar output', async () => {
    render(FormResponses, {
      props: {
        formEvent: {
          ...h.copy,
          tags: h.copy.tags.map((/** @type {string[]} */ t) =>
            t[0] === 'settings' ? ['settings', '{}'] : t
          )
        },
        formAddress
      }
    });
    await fireEvent.click(await screen.findByRole('button', { name: /Anonym/ }));
    await waitFor(() => expect(screen.getByText('OER-Werkstatt')).toBeTruthy());
    expect(screen.queryByRole('button', { name: m.form_responses_to_calendar() })).toBeNull();
  });
});
