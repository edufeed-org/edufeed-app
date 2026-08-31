/** @vitest-environment jsdom */
/**
 * FormResponses — Plan 5 Task 1, item 5. When
 * resolveFormResponseDecryptSigners returns an empty candidate list (no
 * active signer AND no usable community signer), the decrypt-attempt loop
 * never runs. Without an explicit branch that leaves the response stuck
 * forever neither decrypted nor errored — an infinite spinner rather than
 * the existing decrypt-failed message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const FORM_AUTHOR = 'a'.repeat(64);
const RESPONDENT = 'b'.repeat(64);
const FORM_ADDRESS = `30168:${FORM_AUTHOR}:membership`;

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
    content: 'ciphertext',
    tags: [['a', FORM_ADDRESS], ['p', FORM_AUTHOR], ['encrypted']]
  };
}

const { resolveSignersMock } = vi.hoisted(() => ({
  resolveSignersMock: vi.fn(() => [])
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

vi.mock('$lib/helpers/forms.js', () => ({
  parseResponseTags: (/** @type {any} */ tags) => Object.fromEntries(tags.map(() => [])),
  parseFormTemplate: () => ({ fields: [{ id: 'full_name', label: 'Full name' }] }),
  nip44DecryptWith: vi.fn(async () => '[]'),
  resolveFormResponseDecryptSigners: resolveSignersMock
}));

vi.mock('$lib/helpers/community-signer.js', () => ({ getCommunitySigner: () => null }));
vi.mock('$lib/helpers/communityRelays.js', () => ({ parseCommunityContentTypes: () => [] }));
vi.mock('$lib/loaders/community.js', () => ({
  formResponseLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
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

beforeEach(() => {
  resolveSignersMock.mockClear();
});

describe('FormResponses — empty-signers decrypt branch', () => {
  it('shows the decrypt-failed message (not an infinite spinner) when there is no candidate signer', async () => {
    resolveSignersMock.mockReturnValue([]);
    render(FormResponses, { props: { formEvent, formAddress: FORM_ADDRESS } });

    // Expand the response to trigger decryptResponse().
    const header = await screen.findByRole('button');
    await fireEvent.click(header);

    await waitFor(() => expect(screen.getByText('Could not decrypt this response.')).toBeTruthy());
    // No stray loading spinner left behind for this response's expanded panel.
    expect(screen.queryByRole('status')).toBeNull();
  });
});
