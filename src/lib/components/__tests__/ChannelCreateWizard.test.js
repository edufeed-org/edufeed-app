/** @vitest-environment jsdom */
/**
 * ChannelCreateWizard — 3-step create flow (Task 9). Covers the two
 * disablement gates (Next blocked until name; Create blocked until the
 * key-loss disclosure is acknowledged) plus the invite-loop failure
 * isolation: once createChannel succeeds, a failing grantChannelAccess must
 * neither block the other grants nor keep the wizard open — the channel
 * always surfaces via onCreated, with a partial-failure toast.
 * Founding/publish idempotency is exercised at the unit level in
 * concord-founding.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

const PUBKEY = 'a'.repeat(64);
const MEMBER_B = 'b'.repeat(64);
const MEMBER_E = 'e'.repeat(64);

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64), signer: {} },
  getAccountForPubkey: vi.fn(() => ({ signer: {} }))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  accountsMeta: { version: 0 }
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: mockManager,
  accountsMeta: { version: 0 }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true, relays: ['wss://concord.example'] } }
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/concord/founding.js', () => ({
  foundConcordArea: vi.fn()
}));

const directInviteToArea = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/concord/area-invite.js', () => ({ directInviteToArea }));

// NIP-29 group-management spies — the deleted create-tab test's shape,
// extended with the two the wizard's put-user fan-out also needs.
const { createGroupOnRelay, generateGroupId, publishToGroupRelay, buildPutUserTemplate } =
  vi.hoisted(() => ({
    createGroupOnRelay: vi.fn(async (/** @type {any} */ _args) => ({ kind: 39000, tags: [] })),
    generateGroupId: vi.fn(() => 'new-group-id'),
    publishToGroupRelay: vi.fn(
      async (
        /** @type {any} */ _conn,
        /** @type {any} */ _template,
        /** @type {any} */ _user
      ) => ({})
    ),
    buildPutUserTemplate: vi.fn((/** @type {string} */ groupId, /** @type {string} */ pubkey) => ({
      kind: 9000,
      tags: [
        ['h', groupId],
        ['p', pubkey]
      ]
    }))
  }));
vi.mock('$lib/groups/group-management.js', () => ({
  createGroupOnRelay,
  generateGroupId,
  publishToGroupRelay,
  buildPutUserTemplate
}));

const attachGroupChannel = vi.hoisted(() => vi.fn(async (/** @type {any} */ _args) => ({})));
vi.mock('$lib/groups/community-attach.js', () => ({ attachGroupChannel }));

const relayConnStub = { publish: vi.fn(), request: vi.fn() };
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relayConnStub) },
  // ProfileAvatar imports eventStore statically — a bare partial mock (only
  // `pool`) breaks it even though this suite never renders a profile.
  eventStore: {
    model: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) })),
    profile: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
  }
}));

// Controllable roster fixture for the (tier==='members') fan-out union —
// real stufe2Pointers/areaMemberRows run on top of this, only the network
// subscription itself is stubbed.
const rosterState = vi.hoisted(() => ({ membersByKey: /** @type {any} */ ({}) }));
vi.mock('$lib/groups/channel-rosters.svelte.js', () => ({
  useChannelRosters: () => () => ({
    membersByKey: rosterState.membersByKey,
    adminsByKey: {},
    refresh: () => {}
  })
}));

vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);

// Two invitable members (self is filtered out by the component). A vi.fn
// (not a bare arrow) so individual tests can override allMembers via
// mockReturnValueOnce — needed by the "excludes the community pubkey too"
// case below. vi.clearAllMocks() in beforeEach clears calls, not this
// default implementation.
const getVerifiedMembersMock = vi.hoisted(() =>
  vi.fn((/** @type {any[]} */ ..._args) => ({
    allMembers: ['a'.repeat(64), 'b'.repeat(64), 'e'.repeat(64)],
    perSection: new Map()
  }))
);
vi.mock('$lib/helpers/contentTypes.js', () => ({
  getVerifiedMembers: (/** @type {any[]} */ ...args) => getVerifiedMembersMock(...args)
}));

import { channelKey } from '$lib/groups/community-pointer.js';
import ChannelCreateWizard from '$lib/components/community/channels/ChannelCreateWizard.svelte';

/** Fill the name, walk to step 3, acknowledge the disclosure. */
async function walkToCreate(/** @type {string[]} */ invitees = []) {
  const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
  await fireEvent.input(nameInput, { target: { value: 'Staff room' } });

  let next = screen.getByRole('button', { name: /Next|Weiter/ });
  await fireEvent.click(next); // → step 1 (invite)

  for (const pubkey of invitees) {
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(pubkey.slice(0, 12)) }));
  }

  next = screen.getByRole('button', { name: /Next|Weiter/ });
  await fireEvent.click(next); // → step 2 (good to know)

  await fireEvent.click(screen.getByRole('checkbox'));
  return /** @type {HTMLButtonElement} */ (
    screen.getByRole('button', { name: /Create channel|Kanal erstellen/ })
  );
}

describe('ChannelCreateWizard', () => {
  const baseProps = {
    communikeyEvent: { kind: 10222, pubkey: PUBKEY, tags: [], content: '' },
    onClose: () => {},
    onCreated: () => {}
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables Next until a name is entered', async () => {
    render(ChannelCreateWizard, { props: baseProps });
    const next = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /Next|Weiter/ })
    );
    expect(next.disabled).toBe(true);

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    expect(next.disabled).toBe(false);
  });

  it('excludes the community pubkey from the invite list too, not just the active account (separate-keypair owner, handoff #12)', async () => {
    // The active account is a personal keypair distinct from the community
    // being managed — but the community's own pubkey can still show up in
    // allMembers (e.g. counted as a verified "member"/owner) and must not
    // be offered as someone to invite to their own channel.
    const COMMUNITY_PK = 'c'.repeat(64);
    getVerifiedMembersMock.mockReturnValueOnce({
      allMembers: [COMMUNITY_PK, MEMBER_B, mockManager.active.pubkey],
      perSection: new Map()
    });
    render(ChannelCreateWizard, {
      props: {
        ...baseProps,
        communikeyEvent: { kind: 10222, pubkey: COMMUNITY_PK, tags: [], content: '' }
      }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 1 (invite)

    expect(
      screen.queryByRole('button', { name: new RegExp(COMMUNITY_PK.slice(0, 12)) })
    ).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(MEMBER_B.slice(0, 12)) })).toBeTruthy();
  });

  it('disables Create until the key-loss disclosure is acknowledged', async () => {
    render(ChannelCreateWizard, { props: baseProps });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });

    let next = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /Next|Weiter/ })
    );
    await fireEvent.click(next); // step 1 (invite)

    next = /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(next); // step 2 (good to know)

    const create = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: /Create channel|Kanal erstellen/ })
    );
    expect(create.disabled).toBe(true);

    const checkbox = screen.getByRole('checkbox');
    await fireEvent.click(checkbox);
    expect(create.disabled).toBe(false);
  });

  it('surfaces the channel via onCreated with a partial toast when some grants fail', async () => {
    const createChannel = vi.fn(async () => 'chan-1');
    const grantChannelAccess = vi
      .fn()
      .mockRejectedValueOnce(new Error('gift wrap failed'))
      .mockResolvedValue(undefined);
    const onCreated = vi.fn();

    render(ChannelCreateWizard, {
      props: {
        ...baseProps,
        community: { createChannel, grantChannelAccess },
        onCreated
      }
    });

    const create = await walkToCreate([MEMBER_B, MEMBER_E]);
    await fireEvent.click(create);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('chan-1'));
    expect(createChannel).toHaveBeenCalledTimes(1);
    // first grant failed, loop still attempted the second
    expect(grantChannelAccess).toHaveBeenCalledTimes(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    const [message, type] = toastSpy.mock.calls[0];
    expect(type).toBe('warning');
    expect(message).toMatch(/1.*2|2.*1/); // "{failed} of {total}"
  });

  it('surfaces the channel with a success toast when all grants succeed', async () => {
    const createChannel = vi.fn(async () => 'chan-2');
    const grantChannelAccess = vi.fn().mockResolvedValue(undefined);
    const onCreated = vi.fn();

    render(ChannelCreateWizard, {
      props: {
        ...baseProps,
        community: { createChannel, grantChannelAccess },
        onCreated
      }
    });

    const create = await walkToCreate([MEMBER_B]);
    await fireEvent.click(create);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('chan-2'));
    expect(toastSpy.mock.calls[0][1]).toBe('success');
  });
});

describe('ChannelCreateWizard visibility + picker', () => {
  const PK_A = 'a'.repeat(64);

  function makeCommunity() {
    return {
      createChannel: vi.fn(() => Promise.resolve('new-chan')),
      grantChannelAccess: vi.fn(() => Promise.resolve())
    };
  }

  it('creates a PRIVATE channel by default', async () => {
    const community = makeCommunity();
    render(ChannelCreateWizard, {
      props: {
        communikeyEvent: { pubkey: PUBKEY },
        community,
        onClose: () => {},
        onCreated: () => {}
      }
    });
    await walkToCreate();
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));
    await waitFor(() =>
      expect(community.createChannel).toHaveBeenCalledWith('Staff room', { private: true })
    );
  });

  it('creates an OPEN channel when public is chosen', async () => {
    const community = makeCommunity();
    render(ChannelCreateWizard, {
      props: {
        communikeyEvent: { pubkey: PUBKEY },
        community,
        onClose: () => {},
        onCreated: () => {}
      }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 1
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 2
    await fireEvent.click(screen.getByTestId('concord-wizard-ack-checkbox'));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));
    await waitFor(() =>
      expect(community.createChannel).toHaveBeenCalledWith('Staff room', { private: false })
    );
  });

  it('invites a pasted npub from step 2 via the picker', async () => {
    const community = makeCommunity();
    render(ChannelCreateWizard, {
      props: {
        communikeyEvent: { pubkey: PUBKEY },
        community,
        onClose: () => {},
        onCreated: () => {}
      }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Staff room' } });
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 1 (invite)
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 2
    await fireEvent.click(screen.getByTestId('concord-wizard-ack-checkbox'));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));
    await waitFor(() =>
      expect(community.grantChannelAccess).toHaveBeenCalledWith('new-chan', PK_A)
    );
  });

  it('public channel: invitee from step 2 goes through directInviteToArea', async () => {
    const community = makeCommunity();
    render(ChannelCreateWizard, {
      props: {
        communikeyEvent: { pubkey: PUBKEY },
        community,
        onClose: () => {},
        onCreated: () => {}
      }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Open room' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 1
    await fireEvent.click(await screen.findByTestId('stub-raw-a')); // pick a member
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 2
    await fireEvent.click(screen.getByTestId('concord-wizard-ack-checkbox'));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));
    await waitFor(() => expect(directInviteToArea).toHaveBeenCalledWith(community, PK_A));
    expect(community.grantChannelAccess).not.toHaveBeenCalled();
  });
});

describe('ChannelCreateWizard — NIP-29 groups', () => {
  const GROUP_RELAY = 'wss://groups.example/';
  const GROUP_RELAY_B = 'wss://groups-b.example/';
  // channelKey() returns `string | null`; the `?? ''` keeps this a plain
  // string for use as a computed object property key below — for these
  // fixtures it is never actually null.
  const CHAN_A_KEY = channelKey({ id: 'chan-a', relay: GROUP_RELAY }) ?? '';
  const CHAN_B_KEY = channelKey({ id: 'chan-b', relay: GROUP_RELAY }) ?? '';

  /** A 10222 already carrying group pointers → NIP-29 mode. */
  const nip29Community = (extraTags = /** @type {string[][]} */ ([])) => ({
    kind: 10222,
    pubkey: PUBKEY,
    tags: [
      ['group', 'chan-a', GROUP_RELAY, 'General', 'members'],
      ['group', 'chan-b', GROUP_RELAY, 'Staff', 'members'],
      ...extraTags
    ],
    content: ''
  });

  /** No group pointers → Concord mode. */
  const concordCommunity = () => ({ kind: 10222, pubkey: PUBKEY, tags: [], content: '' });

  /** Fill the name and land on the access step for either fixture. */
  async function toAccessStep(/** @type {any} */ communikeyEvent) {
    render(ChannelCreateWizard, {
      props: {
        communikeyEvent,
        onClose: () => {},
        onCreated: () => {}
      }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    rosterState.membersByKey = {};
  });

  it('NIP-29 mode: shows both access radios, weltoffen checkbox only while members is selected', async () => {
    await toAccessStep(nip29Community());

    expect(screen.getByTestId('wizard-access-members')).toBeTruthy();
    expect(screen.getByTestId('wizard-access-invited')).toBeTruthy();
    // Default tier is 'invited' (byte-for-byte with the old isPrivate default) — no checkbox yet.
    expect(screen.queryByTestId('wizard-access-worldreadable')).toBeNull();

    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    expect(screen.getByTestId('wizard-access-worldreadable')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('wizard-access-invited'));
    expect(screen.queryByTestId('wizard-access-worldreadable')).toBeNull();
  });

  it('Concord mode: no weltoffen checkbox in either access state', async () => {
    await toAccessStep(concordCommunity());

    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    expect(screen.queryByTestId('wizard-access-worldreadable')).toBeNull();

    await fireEvent.click(screen.getByTestId('wizard-access-invited'));
    expect(screen.queryByTestId('wizard-access-worldreadable')).toBeNull();
  });

  it('creates a NIP-29 group on the shared relay, attaches it, and fans out put-user', async () => {
    const onCreated = vi.fn();
    const communikeyEvent = nip29Community();
    // BOTH Stufe-2 rosters answered (empty) — the gate now requires EVERY
    // channelKey, not just one — clears the loading gate without adding
    // anyone to the union, keeping this test's assertions narrow.
    rosterState.membersByKey = { [CHAN_A_KEY]: new Set(), [CHAN_B_KEY]: new Set() };
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByTestId('wizard-access-worldreadable'));

    // Group mode is 2 steps — this Next lands on step 1, which is the FINAL
    // step (invite + Create, no separate "good to know" step).
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(MEMBER_B.slice(0, 12)) }));

    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(createGroupOnRelay).toHaveBeenCalledTimes(1));
    const createArgs = createGroupOnRelay.mock.calls[0][0];
    expect(createArgs.relayConn).toBe(relayConnStub);
    expect(createArgs.metadata).toEqual(expect.objectContaining({ isPublic: true, isOpen: false }));
    expect(createArgs.user).toBe(mockManager.active);

    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    expect(attachGroupChannel.mock.calls[0][0].pointer).toEqual(
      expect.objectContaining({ access: 'members' })
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    // put-user built for the selected invitee.
    expect(buildPutUserTemplate).toHaveBeenCalledWith('new-group-id', MEMBER_B);
  });

  it('mixed-relay pointers: aborts with the shared-relay error toast, never calls create', async () => {
    const communikeyEvent = nip29Community([
      ['group', 'chan-c', GROUP_RELAY_B, 'Other', 'members']
    ]);
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated: () => {} }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    // Default tier is 'invited' (no roster gating), and group mode is 2
    // steps — one Next reaches the final (invite/Create) step.
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const [message, type] = toastSpy.mock.calls[0];
    expect(type).toBe('error');
    expect(typeof message).toBe('string');
    expect(createGroupOnRelay).not.toHaveBeenCalled();
  });

  // Reviewer finding 1: useChannelRosters debounces + round-trips relays —
  // a fast user must not be able to hit Create before any existing Stufe-2
  // roster has answered, which would silently ship a members-tier channel
  // missing every implicit member (with a SUCCESS toast, no failure count
  // to warn them).
  it('disables Create while an existing members-tier roster has not loaded yet', async () => {
    const communikeyEvent = nip29Community(); // two Stufe-2 pointers, no roster answered yet
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated: () => {} }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → final step

    const create = /** @type {HTMLButtonElement} */ (screen.getByTestId('concord-wizard-create'));
    expect(create.disabled).toBe(true);
    expect(screen.getByTestId('wizard-rosters-loading')).toBeTruthy();
  });

  // Finding 4: the gate used to unblock on SOME loaded roster — a community
  // with two Stufe-2 channels where only one has answered would let Create
  // through and silently drop the other channel's implicit members. It must
  // require EVERY Stufe-2 channelKey to be answered.
  it('keeps Create disabled while only SOME of several members-tier rosters have loaded', async () => {
    const communikeyEvent = nip29Community(); // two Stufe-2 pointers: chan-a, chan-b
    rosterState.membersByKey = { [CHAN_A_KEY]: new Set() }; // chan-b still unanswered
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated: () => {} }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → final step

    const create = /** @type {HTMLButtonElement} */ (screen.getByTestId('concord-wizard-create'));
    expect(create.disabled).toBe(true);
    expect(screen.getByTestId('wizard-rosters-loading')).toBeTruthy();
  });

  it('fans out put-user to the existing members-tier roster union, deduping the explicit invitee and excluding self', async () => {
    const communikeyEvent = nip29Community();
    // MEMBER_B is already in the Stufe-2 roster, and so — implausibly, but
    // exercising the exclusion — is the acting user themselves. Both
    // channelKeys must be answered for the "every" gate to clear.
    rosterState.membersByKey = {
      [CHAN_A_KEY]: new Set([MEMBER_B, mockManager.active.pubkey]),
      [CHAN_B_KEY]: new Set()
    };
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated: () => {} }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → final step
    // Also explicitly select MEMBER_B — already in the roster union.
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(MEMBER_B.slice(0, 12)) }));

    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    const putUserTargets = buildPutUserTemplate.mock.calls.map((args) => args[1]);
    // MEMBER_B appears exactly once despite being both explicitly selected
    // AND present in the roster union (dedup).
    expect(putUserTargets.filter((pubkey) => pubkey === MEMBER_B)).toHaveLength(1);
    // Self never gets a put-user, even though present in the roster union.
    expect(putUserTargets).not.toContain(mockManager.active.pubkey);
  });

  // Finding 1 (CRITICAL): attachGroupChannel's optimistic 10222 echo updates
  // communikeyEvent synchronously — a naive read of the member union AFTER
  // the attach would see the NEW pointer already listed, invalidate the
  // roster hook's key, and read an empty union. Simulate exactly that
  // invalidation from inside the mocked attach and prove the fan-out still
  // carries the member captured before it happened.
  it('keeps the pre-attach member union even when attach invalidates the roster mid-flight', async () => {
    const communikeyEvent = nip29Community();
    rosterState.membersByKey = {
      [CHAN_A_KEY]: new Set([MEMBER_B]),
      [CHAN_B_KEY]: new Set()
    };
    attachGroupChannel.mockImplementationOnce(async () => {
      // Simulate the optimistic-echo invalidation: the roster hook's
      // pointersKey changed underneath it, wiping every loaded roster.
      rosterState.membersByKey = {};
      return {};
    });
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated: () => {} }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → final step

    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(buildPutUserTemplate).toHaveBeenCalledWith('new-group-id', MEMBER_B)
    );
  });

  // Finding 3 (IMPORTANT): a createGroupOnRelay success followed by an
  // attachGroupChannel failure must not read as "creation failed" — the
  // group already exists on the relay, and a generic error toast invites a
  // retry that mints a second orphan. It gets its own warning toast naming
  // the id, the wizard stays open (no onCreated), and no put-user goes out.
  it('warns with the group id and keeps the wizard open when attach fails after the group is created', async () => {
    const communikeyEvent = nip29Community();
    rosterState.membersByKey = { [CHAN_A_KEY]: new Set(), [CHAN_B_KEY]: new Set() };
    attachGroupChannel.mockRejectedValueOnce(new Error('publish failed'));
    const onCreated = vi.fn();
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → final step

    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const [message, type] = toastSpy.mock.calls[0];
    expect(type).toBe('warning');
    expect(message).toContain('new-group-id');

    expect(createGroupOnRelay).toHaveBeenCalledTimes(1);
    expect(publishToGroupRelay).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
