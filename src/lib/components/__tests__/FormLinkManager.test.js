/** @vitest-environment jsdom */
/**
 * FormLinkManager — saveFormLink must sign the kind-30000 profile-list
 * rewrite with the COMMUNITY's own signer (getCommunitySigner), not the
 * active account — the two differ for a community run from a separate
 * keypair (handoff #12). This locks in the wiring: getCommunitySigner is
 * called with the community pubkey, and the resulting signed event carries
 * that pubkey too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const COMMUNITY_PK = 'aa'.repeat(32);

/** No-op observable stub: subscribe() optionally calls back once, sync. */
function stubObservable(/** @type {any} */ value = undefined) {
  return {
    subscribe: (/** @type {any} */ cb) => {
      if (cb) cb(value);
      return { unsubscribe: () => {} };
    }
  };
}

vi.mock('$lib/loaders/community.js', () => ({
  formTemplateLoader: () => () => stubObservable()
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => stubObservable()
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => []
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const existingProfileListEvent = vi.hoisted(() => ({
  kind: 30000,
  pubkey: 'aa'.repeat(32),
  tags: [['d', 'members']],
  content: ''
}));

const mockEventStore = vi.hoisted(() => ({
  model: () => ({ subscribe: (/** @type {any} */ cb) => (cb?.([]), { unsubscribe: () => {} }) }),
  replaceable: () => ({
    subscribe: (/** @type {any} */ cb) => (
      cb?.(existingProfileListEvent), { unsubscribe: () => {} }
    )
  }),
  add: vi.fn()
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: mockEventStore
}));

const mockPublishEvent = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => mockPublishEvent(...args)
}));

const mockSignEvent = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ draft) => ({ ...draft, id: 'signedid', sig: 'fakesig' }))
);
const communitySigner = vi.hoisted(() => ({ signEvent: /** @type {any} */ (null) }));
const mockGetCommunitySigner = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/community-signer.js', () => ({
  getCommunitySigner: (/** @type {string} */ pk) => mockGetCommunitySigner(pk)
}));

import FormLinkManager from '$lib/components/forms/FormLinkManager.svelte';

const communityEvent = {
  kind: 10222,
  pubkey: COMMUNITY_PK,
  tags: [
    ['d', 'test-community'],
    ['content', 'members'],
    ['a', `30000:${COMMUNITY_PK}:members`]
  ],
  content: ''
};

describe('FormLinkManager — saves with the community signer, not the active account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communitySigner.signEvent = mockSignEvent;
    mockGetCommunitySigner.mockReturnValue(communitySigner);
    mockPublishEvent.mockResolvedValue({ success: true });
  });

  it('signs the kind-30000 rewrite with getCommunitySigner(communityPubkey), pubkey stamped to the community', async () => {
    render(FormLinkManager, { props: { communityEvent, communityPubkey: COMMUNITY_PK } });

    const select = screen.getByRole('combobox');
    await fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => expect(mockSignEvent).toHaveBeenCalled());

    expect(mockGetCommunitySigner).toHaveBeenCalledWith(COMMUNITY_PK);
    const signedDraft = mockSignEvent.mock.calls[0][0];
    expect(signedDraft.pubkey).toBe(COMMUNITY_PK);
    expect(signedDraft.kind).toBe(30000);
    expect(mockPublishEvent).toHaveBeenCalled();
    expect(mockEventStore.add).toHaveBeenCalled();
  });

  it('does not attempt to sign/publish when the manager holds no signer for the community', async () => {
    mockGetCommunitySigner.mockReturnValue(null);
    render(FormLinkManager, { props: { communityEvent, communityPubkey: COMMUNITY_PK } });

    const select = screen.getByRole('combobox');
    await fireEvent.change(select, { target: { value: '' } });

    expect(mockSignEvent).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});
