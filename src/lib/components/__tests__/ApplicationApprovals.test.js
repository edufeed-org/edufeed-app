/** @vitest-environment jsdom */
/**
 * ApplicationApprovals — Task 7. Admin queue of kind 1069 membership
 * applications for a moderated community: decrypt-and-render, Approve
 * (root put-user, then fan-out over the community's Stufe-2 channels, then
 * roster refresh, then a best-effort NIP-17 DM — in that order) and Decline
 * (persistent localStorage dismissal + best-effort DM + in-session undo).
 * Roster members render as already-approved (no buttons).
 *
 * formResponseLoader/selectAdminApplications/putUserOn/fanOut/sendWrappedDm
 * internals are covered by their own suites; this proves the wiring and the
 * approve call-order contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const ADMIN = 'a'.repeat(64);
const APPLICANT_MINE = 'b'.repeat(64);
const APPLICANT_OTHER_ADMIN = 'c'.repeat(64);
const APPLICANT_ROSTER_MEMBER = 'd'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN}:membership`;
const GROUPS_RELAY = 'wss://groups.example/';
const CHANNEL_RELAY = 'wss://channels.example/';

// vi.mock factories are hoisted above module-level consts, so everything a
// factory closes over must be built via vi.hoisted() (TDZ, see
// SettingsView.test.js's header note).
const {
  timelineFixture,
  putUserOnMock,
  fanOutMock,
  sendWrappedDmMock,
  showToastMock,
  nip44DecryptMock
} = vi.hoisted(() => ({
  timelineFixture: /** @type {{ value: any[] }} */ ({ value: [] }),
  putUserOnMock: vi.fn(async () => ({ id: 'put' })),
  fanOutMock: vi.fn(async () => ({ ok: [], failed: [] })),
  sendWrappedDmMock: vi.fn(async () => undefined),
  showToastMock: vi.fn(),
  nip44DecryptMock: vi.fn(async (_pubkey, ciphertext) => ciphertext)
}));

/** @param {string} id @param {string} pubkey @param {Record<string,string>} values */
function makeResponse(id, pubkey, values) {
  return {
    id,
    kind: 1069,
    pubkey,
    created_at: 1_700_000_000,
    // nip44DecryptMock echoes content back — content IS the plaintext tags.
    content: JSON.stringify(Object.entries(values).map(([k, v]) => ['response', k, v])),
    tags: [['a', FORM_ADDRESS], ['p', ADMIN], ['encrypted']]
  };
}

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ADMIN, signer: { nip44: { decrypt: nip44DecryptMock } } })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (/** @type {any} */ _Model, /** @type {any} */ ..._args) => ({
      subscribe: (/** @type {(v: any) => void} */ cb) => {
        cb(timelineFixture.value);
        return { unsubscribe: () => {} };
      }
    })
  }
}));

vi.mock('$lib/loaders/community.js', () => ({
  formResponseLoader: vi.fn(() => () => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
}));

vi.mock('$lib/loaders/base.js', () => ({
  createCachedTimelineLoader: vi.fn(() => () => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example/']
}));

vi.mock('$lib/groups/roster-fanout.js', () => ({
  putUserOn: putUserOnMock,
  fanOut: fanOutMock
}));

vi.mock('$lib/services/wrapped-dm.js', () => ({ sendWrappedDm: sendWrappedDmMock }));
vi.mock('$lib/helpers/toast', () => ({ showToast: showToastMock }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

vi.mock('$lib/paraglide/messages', () => ({
  community_applications_title: () => 'Beitrittsanfragen',
  community_applications_empty: () => 'Keine offenen Anfragen.',
  community_applications_approve: () => 'Aufnehmen',
  community_applications_decline: () => 'Ablehnen',
  community_applications_undo: () => 'Rückgängig',
  community_applications_approved_badge: () => 'Aufgenommen',
  community_applications_decrypt_failed: () => 'Antwort konnte nicht entschlüsselt werden.',
  community_application_approved_dm: (/** @type {{community: string}} */ p) =>
    `Deine Beitrittsanfrage für ${p.community} wurde angenommen — willkommen!`,
  community_application_declined_dm: (/** @type {{community: string}} */ p) =>
    `Deine Beitrittsanfrage für ${p.community} wurde leider abgelehnt.`,
  community_application_approve_failed: (/** @type {{reason: string}} */ p) =>
    `Aufnahme fehlgeschlagen: ${p.reason}`,
  area_members_fanout_partial: (/** @type {{failed: number, total: number}} */ p) =>
    `${p.failed} von ${p.total} Kanälen abgelehnt`
}));

const { default: ApplicationApprovals } = await import(
  '$lib/components/community/settings/ApplicationApprovals.svelte'
);

const rootPointer = { id: 'root1', relay: GROUPS_RELAY };
const channelPointer = { id: 'chan1', relay: CHANNEL_RELAY };

const communikeyEvent = {
  kind: 10222,
  pubkey: ADMIN,
  created_at: 1000,
  tags: [
    ['membership', 'root1', GROUPS_RELAY],
    ['application', FORM_ADDRESS, 'wss://communikey.example/'],
    ['group', 'chan1', CHANNEL_RELAY, 'General', 'members']
  ]
};

/** @param {Record<string, any>} overrides */
function renderPanel(overrides = {}) {
  const roster = {
    pointer: rootPointer,
    members: new Set(),
    admins: [],
    refresh: vi.fn(),
    isLoading: false,
    isMember: () => false,
    rolesOf: () => []
  };
  return render(ApplicationApprovals, {
    props: {
      communikeyEvent,
      communityId: ADMIN,
      communityName: 'Testgemeinschaft',
      roster,
      ...overrides
    }
  });
}

function localStorageKey(/** @type {string} */ pubkey) {
  return `communityApplication:declined:${ADMIN}:${pubkey}`;
}

beforeEach(() => {
  timelineFixture.value = [];
  putUserOnMock.mockClear().mockResolvedValue({ id: 'put' });
  fanOutMock.mockClear().mockResolvedValue({ ok: [], failed: [] });
  sendWrappedDmMock.mockClear().mockResolvedValue(undefined);
  showToastMock.mockClear();
  nip44DecryptMock.mockClear();
  nip44DecryptMock.mockImplementation(async (_pubkey, ciphertext) => ciphertext);
  window.localStorage.clear();
});

describe('ApplicationApprovals', () => {
  it('renders the empty state when there are no applications', () => {
    renderPanel();
    expect(screen.getByTestId('application-approvals')).toBeTruthy();
    expect(screen.getByText('Keine offenen Anfragen.')).toBeTruthy();
  });

  it('shows only the copy p-tagged to me, decrypted', async () => {
    timelineFixture.value = [
      makeResponse('mine', APPLICANT_MINE, { full_name: 'Maria' }),
      {
        ...makeResponse('other', APPLICANT_OTHER_ADMIN, { full_name: 'Someone Else' }),
        tags: [['a', FORM_ADDRESS], ['p', 'e'.repeat(64)], ['encrypted']]
      }
    ];
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId(`application-approve-${APPLICANT_MINE}`)).toBeTruthy()
    );
    expect(screen.queryByTestId(`application-approve-${APPLICANT_OTHER_ADMIN}`)).toBeNull();
    await waitFor(() => expect(screen.getByText('Maria')).toBeTruthy());
  });

  it('shows a decrypt-failed notice when decryption throws', async () => {
    nip44DecryptMock.mockRejectedValueOnce(new Error('bad key'));
    timelineFixture.value = [makeResponse('mine', APPLICANT_MINE, { full_name: 'Maria' })];
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText('Antwort konnte nicht entschlüsselt werden.')).toBeTruthy()
    );
  });

  it('roster members render as approved with no action buttons', async () => {
    timelineFixture.value = [makeResponse('r', APPLICANT_ROSTER_MEMBER, { full_name: 'Rosi' })];
    renderPanel({
      roster: {
        pointer: rootPointer,
        members: new Set([APPLICANT_ROSTER_MEMBER]),
        admins: [],
        refresh: vi.fn(),
        isLoading: false,
        isMember: () => true,
        rolesOf: () => []
      }
    });

    await waitFor(() => expect(screen.getByText('Aufgenommen')).toBeTruthy());
    expect(screen.queryByTestId(`application-approve-${APPLICANT_ROSTER_MEMBER}`)).toBeNull();
    expect(screen.queryByTestId(`application-decline-${APPLICANT_ROSTER_MEMBER}`)).toBeNull();
  });

  it('approve: calls root putUserOn, then fanOut over stufe-2 pointers, then refresh, then DM — in that order', async () => {
    timelineFixture.value = [makeResponse('mine', APPLICANT_MINE, { full_name: 'Maria' })];
    const refresh = vi.fn();
    renderPanel({
      roster: {
        pointer: rootPointer,
        members: new Set(),
        admins: [],
        refresh,
        isLoading: false,
        isMember: () => false,
        rolesOf: () => []
      }
    });

    const btn = await screen.findByTestId(`application-approve-${APPLICANT_MINE}`);
    await fireEvent.click(btn);

    await waitFor(() => expect(sendWrappedDmMock).toHaveBeenCalled());

    // Root put-user first, addressed to the ROOT pointer.
    expect(putUserOnMock).toHaveBeenCalledWith(
      rootPointer,
      APPLICANT_MINE,
      [],
      expect.objectContaining({ pubkey: ADMIN })
    );
    // Fan-out over the stufe-2 (access:"members") channel pointers.
    expect(fanOutMock).toHaveBeenCalledOnce();
    const [items] = /** @type {any[]} */ (fanOutMock.mock.calls[0]);
    expect(items).toEqual([expect.objectContaining(channelPointer)]);

    // Order: root putUser -> fanOut -> refresh -> DM.
    const rootCallOrder = putUserOnMock.mock.invocationCallOrder[0];
    const fanOutCallOrder = fanOutMock.mock.invocationCallOrder[0];
    const refreshCallOrder = refresh.mock.invocationCallOrder[0];
    const dmCallOrder = sendWrappedDmMock.mock.invocationCallOrder[0];
    expect(rootCallOrder).toBeLessThan(fanOutCallOrder);
    expect(fanOutCallOrder).toBeLessThan(refreshCallOrder);
    expect(refreshCallOrder).toBeLessThan(dmCallOrder);

    expect(sendWrappedDmMock).toHaveBeenCalledWith(
      APPLICANT_MINE,
      expect.stringContaining('Testgemeinschaft')
    );
  });

  it('approve failure shows a toast and leaves the applicant in the queue', async () => {
    putUserOnMock.mockRejectedValueOnce(new Error('relay down'));
    timelineFixture.value = [makeResponse('mine', APPLICANT_MINE, { full_name: 'Maria' })];
    renderPanel();

    const btn = await screen.findByTestId(`application-approve-${APPLICANT_MINE}`);
    await fireEvent.click(btn);

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('relay down'), 'error')
    );
    expect(fanOutMock).not.toHaveBeenCalled();
    expect(sendWrappedDmMock).not.toHaveBeenCalled();
    // Still in the queue.
    expect(screen.getByTestId(`application-approve-${APPLICANT_MINE}`)).toBeTruthy();
  });

  it('decline: persists a localStorage dismissal, hides the row, and best-effort DMs', async () => {
    timelineFixture.value = [makeResponse('mine', APPLICANT_MINE, { full_name: 'Maria' })];
    renderPanel();

    const btn = await screen.findByTestId(`application-decline-${APPLICANT_MINE}`);
    await fireEvent.click(btn);

    expect(window.localStorage.getItem(localStorageKey(APPLICANT_MINE))).toBeTruthy();
    expect(screen.queryByTestId(`application-approve-${APPLICANT_MINE}`)).toBeNull();
    await waitFor(() =>
      expect(sendWrappedDmMock).toHaveBeenCalledWith(
        APPLICANT_MINE,
        expect.stringContaining('Testgemeinschaft')
      )
    );
  });

  it('decline persists across a re-render (localStorage-backed, not session-only)', async () => {
    window.localStorage.setItem(localStorageKey(APPLICANT_MINE), '1');
    timelineFixture.value = [makeResponse('mine', APPLICANT_MINE, { full_name: 'Maria' })];
    renderPanel();

    await waitFor(() =>
      expect(screen.queryByTestId(`application-approve-${APPLICANT_MINE}`)).toBeNull()
    );
  });

  it('undo affordance clears the decline and restores the row', async () => {
    timelineFixture.value = [makeResponse('mine', APPLICANT_MINE, { full_name: 'Maria' })];
    renderPanel();

    await fireEvent.click(await screen.findByTestId(`application-decline-${APPLICANT_MINE}`));
    expect(window.localStorage.getItem(localStorageKey(APPLICANT_MINE))).toBeTruthy();

    await fireEvent.click(await screen.findByText('Rückgängig'));

    expect(window.localStorage.getItem(localStorageKey(APPLICANT_MINE))).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId(`application-approve-${APPLICANT_MINE}`)).toBeTruthy()
    );
  });
});
