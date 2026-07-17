/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';

const ADMIN_PUBKEY = 'a'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;
const APPLICANT_PUBKEY = 'b'.repeat(64);

// `vi.hoisted` runs before the hoisted vi.mock factories, so values created
// here are usable inside the factory closures below.
const hoisted = vi.hoisted(() => ({
  /** @type {{ events: any[] }} */
  timelineState: { events: [] },
  nip44DecryptMock: vi.fn(),
  actionRunnerOptimisticRunMock: vi.fn(),
  /** Stub for SendWrappedMessage. We compare identity so the test can verify
   *  approve() passes the right builder to the action runner. */
  sendWrappedMessageMock: vi.fn(
    /** @param {any[]} args */ (...args) => ({ __action: 'SendWrappedMessage', args })
  )
}));
const { timelineState, nip44DecryptMock, actionRunnerOptimisticRunMock, sendWrappedMessageMock } =
  hoisted;

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return {
        enabled: true,
        handleDomain: 'edufeed.org',
        formAddress: 'a'.repeat(64).padStart(0) && `30168:${'a'.repeat(64)}:edufeed-membership`,
        adminPubkeys: ['a'.repeat(64)]
      };
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      pubkey: 'a'.repeat(64),
      signer: {
        nip44: { decrypt: hoisted.nip44DecryptMock },
        signEvent: async (/** @type {any} */ draft) => ({
          ...draft,
          id: 'sig-id',
          pubkey: 'a'.repeat(64),
          sig: 'sig'
        })
      }
    }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (/** @type {any} */ _Model, /** @type {any} */ _filter) => ({
      subscribe: (/** @type {(events: any[]) => void} */ cb) => {
        cb(hoisted.timelineState.events);
        return { unsubscribe: () => {} };
      }
    })
  },
  // Imported through the shared profile-loading chain since cd1a6a25.
  pool: {}
}));

vi.mock('$lib/loaders/community.js', () => ({
  formResponseLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: vi.fn(), sign: vi.fn() })
}));

vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: {
    run: (/** @type {any} */ builder, /** @type {any} */ ...args) =>
      hoisted.actionRunnerOptimisticRunMock(builder, ...args)
  }
}));

vi.mock('$lib/services/dm-relay-backfill.js', () => ({
  ensureDmRelayList: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('applesauce-actions/actions', () => ({
  SendWrappedMessage: hoisted.sendWrappedMessageMock
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

import MembershipApprovalsPanel from '../MembershipApprovalsPanel.svelte';

/** @returns {any} */
function makeResponse(wishedHandle = 'maria') {
  return {
    id: 'resp-1',
    kind: 1069,
    pubkey: APPLICANT_PUBKEY,
    created_at: 1_700_000_000,
    content: '<encrypted>',
    tags: [['a', FORM_ADDRESS], ['p', ADMIN_PUBKEY], ['encrypted']],
    _wishedHandle: wishedHandle
  };
}

/**
 * Build a fetch mock that routes by URL: the upstream NIP-05 .well-known check
 * returns `wellKnown`, and the proxy POST returns `proxyPost`.
 *
 * @param {object} opts
 * @param {Response} opts.wellKnown
 * @param {Response} [opts.proxyPost]
 */
function mockFetch({ wellKnown, proxyPost }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/.well-known/nostr.json')) return wellKnown.clone();
    if (url.includes('/api/nip05') && proxyPost) return proxyPost.clone();
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

const emptyWellKnown = () => new Response(JSON.stringify({ names: {} }), { status: 200 });

describe('MembershipApprovalsPanel', () => {
  beforeEach(() => {
    timelineState.events = [];
    nip44DecryptMock.mockClear();
    nip44DecryptMock.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
    actionRunnerOptimisticRunMock.mockReset();
    actionRunnerOptimisticRunMock.mockResolvedValue(undefined);
    sendWrappedMessageMock.mockClear();
    vi.restoreAllMocks();
  });

  it('renders empty state when there are no responses', () => {
    const { queryByRole } = render(MembershipApprovalsPanel);
    expect(queryByRole('button', { name: /Approve|Genehmigen/i })).toBeNull();
  });

  it('renders an Approve button per response with the decrypted wished_handle', async () => {
    timelineState.events = [makeResponse('maria')];
    mockFetch({ wellKnown: emptyWellKnown() });
    const { findByText } = render(MembershipApprovalsPanel);

    await findByText(/maria/);
    expect(nip44DecryptMock).toHaveBeenCalledWith(APPLICANT_PUBKEY, '<encrypted>');
  });

  it('calls /api/nip05 with NIP-98 Authorization on Approve click', async () => {
    timelineState.events = [makeResponse('maria')];
    const fetchSpy = mockFetch({
      wellKnown: emptyWellKnown(),
      proxyPost: new Response(JSON.stringify({ name: 'maria', pubkey: APPLICANT_PUBKEY }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    });

    const { findByRole } = render(MembershipApprovalsPanel);
    const btn = await findByRole('button', { name: /Approve|Genehmigen/i });
    await fireEvent.click(btn);

    await waitFor(() => {
      const proxyCall = fetchSpy.mock.calls.find((c) => String(c[0]).endsWith('/api/nip05'));
      expect(proxyCall).toBeDefined();
    });
    const proxyCall = /** @type {any[]} */ (
      fetchSpy.mock.calls.find((c) => String(c[0]).endsWith('/api/nip05'))
    );
    const [calledUrl, init] = proxyCall;
    expect(String(calledUrl)).toMatch(/\/api\/nip05$/);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toMatch(/^Nostr /);
    const body = JSON.parse(init.body);
    expect(body).toEqual({ name: 'maria', pubkey: APPLICANT_PUBKEY });
  });

  it('surfaces a friendly error on upstream 409 (handle already taken)', async () => {
    timelineState.events = [makeResponse('maria')];
    mockFetch({
      wellKnown: emptyWellKnown(),
      proxyPost: new Response(JSON.stringify({ error: 'Entry already exists' }), { status: 409 })
    });

    const { findByRole, findByText } = render(MembershipApprovalsPanel);
    const btn = await findByRole('button', { name: /Approve|Genehmigen/i });
    await fireEvent.click(btn);

    await findByText(/already taken|bereits vergeben|vergeben/i);
  });

  it('marks a row as approved when the handle already resolves to the applicant', async () => {
    timelineState.events = [makeResponse('maria')];
    mockFetch({
      wellKnown: new Response(JSON.stringify({ names: { maria: APPLICANT_PUBKEY } }), {
        status: 200
      })
    });

    const { queryByRole } = render(MembershipApprovalsPanel);
    // Two matches expected: the section header "Approved (N)" and the per-row badge.
    await waitFor(() => {
      const matches = screen.queryAllByText(/Approved|Genehmigt/i);
      expect(matches.length).toBeGreaterThan(0);
    });
    // The Approve button should no longer be present for this row.
    expect(queryByRole('button', { name: /Approve|Genehmigen/i })).toBeNull();
  });

  it('marks a row as taken when the handle resolves to a different pubkey', async () => {
    timelineState.events = [makeResponse('maria')];
    mockFetch({
      wellKnown: new Response(JSON.stringify({ names: { maria: 'f'.repeat(64) } }), {
        status: 200
      })
    });

    const { findByText } = render(MembershipApprovalsPanel);
    await findByText(/already taken|bereits vergeben|vergeben/i);
  });

  it('sends a NIP-17 notify-DM to the applicant after a successful approve', async () => {
    timelineState.events = [makeResponse('maria')];
    mockFetch({
      wellKnown: emptyWellKnown(),
      proxyPost: new Response(JSON.stringify({ name: 'maria', pubkey: APPLICANT_PUBKEY }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    });

    const { findByRole } = render(MembershipApprovalsPanel);
    const btn = await findByRole('button', { name: /Approve|Genehmigen/i });
    await fireEvent.click(btn);

    await waitFor(() => {
      expect(actionRunnerOptimisticRunMock).toHaveBeenCalled();
    });
    const [builder, recipient, body] = actionRunnerOptimisticRunMock.mock.calls[0];
    expect(builder).toBe(sendWrappedMessageMock);
    expect(recipient).toBe(APPLICANT_PUBKEY);
    expect(typeof body).toBe('string');
    expect(body).toMatch(/maria@edufeed\.org/);
  });

  it('still marks the row approved if the notify-DM fails', async () => {
    timelineState.events = [makeResponse('maria')];
    actionRunnerOptimisticRunMock.mockRejectedValueOnce(new Error('relay down'));
    mockFetch({
      wellKnown: emptyWellKnown(),
      proxyPost: new Response(JSON.stringify({ name: 'maria', pubkey: APPLICANT_PUBKEY }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    });

    const { findByRole } = render(MembershipApprovalsPanel);
    const btn = await findByRole('button', { name: /Approve|Genehmigen/i });
    await fireEvent.click(btn);

    // The row still settles to "approved" — the DM is best-effort.
    // Two matches expected: the section header "Approved (N)" and the per-row badge.
    await waitFor(() => {
      const matches = screen.queryAllByText(/Approved|Genehmigt/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('does not send a notify-DM when approve fails upstream', async () => {
    timelineState.events = [makeResponse('maria')];
    mockFetch({
      wellKnown: emptyWellKnown(),
      proxyPost: new Response(JSON.stringify({ error: 'Entry already exists' }), { status: 409 })
    });

    const { findByRole, findByText } = render(MembershipApprovalsPanel);
    const btn = await findByRole('button', { name: /Approve|Genehmigen/i });
    await fireEvent.click(btn);

    await findByText(/already taken|bereits vergeben|vergeben/i);
    expect(actionRunnerOptimisticRunMock).not.toHaveBeenCalled();
  });
});
