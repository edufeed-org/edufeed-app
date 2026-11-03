/** @vitest-environment jsdom */
/**
 * FormResponses shows multi-valued answers (Edufeed Forms, "Answers with
 * several values") as their entries: one `;`-joined response tag per field,
 * split again on read. Before, a vocabulary answer was stored as
 * "[object Object]" and a text-array answer comma-joined.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { buildResponseTags } from '$lib/helpers/forms.js';

const FORM_AUTHOR = 'a'.repeat(64);
const RESPONDENT = 'b'.repeat(64);
const FORM_ADDRESS = `30168:${FORM_AUTHOR}:membership`;
const LEVEL_A = 'https://w3id.org/kim/educationalLevel/level_A';
const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';

// What the /respond route publishes for these answers, as FieldsRenderer,
// FormConceptPicker and FormRenderer hand them over.
const RESPONSE_TAGS = buildResponseTags({
  topics: 'oer;workshop',
  level: [
    { id: LEVEL_A, nostrCoord: '', relay: '', labels: {} },
    { id: LEVEL_C, nostrCoord: '', relay: '', labels: {} }
  ],
  authors: ['Doe, Jane', 'Smith, John']
});

const formEvent = {
  kind: 30168,
  pubkey: FORM_AUTHOR,
  created_at: 1,
  id: 'form-id',
  sig: 'sig',
  content: '',
  tags: [['d', 'membership']]
};

/** @param {string} id */
function makeResponse(id) {
  return {
    id,
    kind: 1069,
    pubkey: RESPONDENT,
    created_at: 1_700_000_000,
    content: '',
    tags: [['a', FORM_ADDRESS], ['p', FORM_AUTHOR], ...RESPONSE_TAGS]
  };
}

const { resolveSignersMock, FIELDS } = vi.hoisted(() => ({
  resolveSignersMock: vi.fn(() => []),
  FIELDS: [
    {
      id: 'topics',
      type: 'checkbox',
      label: 'Topics',
      options: {
        options: [
          { id: 'oer', label: 'OER' },
          { id: 'workshop', label: 'Workshop' }
        ]
      }
    },
    {
      id: 'level',
      type: 'select',
      label: 'Level',
      options: { multiple: true },
      vocab: { address: '39737:' + 'a'.repeat(64) + ':level', relay: '' }
    },
    { id: 'authors', type: 'text-array', label: 'Authors', options: {} }
  ]
}));

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ url: new URL('http://localhost/admin/membership') }) };
});
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'c'.repeat(64), signer: {} } }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (/** @type {any} */ _Model, /** @type {any} */ _args) => ({
      subscribe: (/** @type {(v: any) => void} */ cb) => {
        cb([makeResponse('r1')]);
        return { unsubscribe: () => {} };
      }
    }),
    replaceable: () => ({
      subscribe: (/** @type {(v: any) => void} */ cb) => {
        cb(null); // no community event — linkedSections stays empty
        return { unsubscribe: () => {} };
      }
    })
  }
}));

vi.mock('$lib/stores/action-runner.svelte.js', () => ({ actionRunner: { run: vi.fn() } }));

vi.mock('$lib/helpers/forms.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    parseFormTemplate: () => ({ fields: FIELDS }),
    nip44DecryptWith: vi.fn(async () => '[]'),
    resolveFormResponseDecryptSigners: resolveSignersMock
  };
});

vi.mock('$lib/helpers/community-signer.js', () => ({ getCommunitySigner: () => null }));
vi.mock('$lib/helpers/communityRelays.js', () => ({ parseCommunityContentTypes: () => [] }));
vi.mock('$lib/loaders/community.js', () => ({
  formResponseLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getCommunikeyRelays: () => [] }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/helpers/dates.js', () => ({ formatTimestamp: () => '1 Jan' }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pk) => `/p/${pk}`
}));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: function Stub() {} }));

vi.mock('$lib/paraglide/messages', () => ({
  form_responses_empty: () => 'No responses yet.',
  form_responses_decrypt_failed: () => 'Could not decrypt this response.'
}));

const { default: FormResponses } = await import('$lib/components/forms/FormResponses.svelte');

describe('FormResponses — multi-valued answers', () => {
  it('round-trips checkbox-group, vocabulary and text-array answers to readable entries', async () => {
    render(FormResponses, { props: { formEvent, formAddress: FORM_ADDRESS } });
    const header = await screen.findByRole('button');
    await fireEvent.click(header);

    await waitFor(() => expect(screen.getByText('OER, Workshop')).toBeTruthy());
    expect(screen.getByText(`${LEVEL_A}, ${LEVEL_C}`)).toBeTruthy();
    expect(screen.getByText('Doe, Jane, Smith, John')).toBeTruthy();
    expect(screen.queryByText(/object Object/)).toBeNull();
  });
});
