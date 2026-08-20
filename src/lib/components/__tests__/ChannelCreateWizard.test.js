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
    buildPutUserTemplate: vi.fn(
      (
        /** @type {string} */ groupId,
        /** @type {string} */ pubkey,
        /** @type {string[]} */ roles = []
      ) => ({
        kind: 9000,
        tags: [['h', groupId], roles.length > 0 ? ['p', pubkey, ...roles] : ['p', pubkey]]
      })
    )
  }));
vi.mock('$lib/groups/group-management.js', () => ({
  createGroupOnRelay,
  generateGroupId,
  publishToGroupRelay,
  buildPutUserTemplate
}));

const attachGroupChannel = vi.hoisted(() => vi.fn(async (/** @type {any} */ _args) => ({})));
vi.mock('$lib/groups/community-attach.js', () => ({ attachGroupChannel }));

const updatePersonalGroupsList = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/groups/personal-groups-list.js', () => ({ updatePersonalGroupsList }));

const relayConnStub = { publish: vi.fn(), request: vi.fn() };
const poolRelaySpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: poolRelaySpy.mockImplementation(() => relayConnStub) },
  // ProfileAvatar imports eventStore statically — a bare partial mock (only
  // `pool`) breaks it even though this suite never renders a profile.
  eventStore: {
    model: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) })),
    profile: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
  }
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

  /** A moderated community BEFORE its first channel: a membership pointer,
   *  zero group pointers. Must run in NIP-29 mode (falling into Concord
   *  founding here would bolt the wrong engine onto a NIP-29 community —
   *  laoc, 2026-08-18) and create on the membership pointer's relay, since
   *  there are no group pointers to share one yet. */
  const moderatedCommunity = () => ({
    kind: 10222,
    pubkey: PUBKEY,
    tags: [['membership', 'root-1', GROUP_RELAY]],
    content: ''
  });

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

  it('moderated community with zero channels runs in NIP-29 mode', async () => {
    await toAccessStep(moderatedCommunity());
    // The weltoffen checkbox is the NIP-29-only affordance — its presence
    // under 'members' proves the wizard did not fall into Concord mode.
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    expect(screen.getByTestId('wizard-access-worldreadable')).toBeTruthy();
  });

  it('first channel of a moderated community: creates on the FLAT host, addresses via /c/<rootId>', async () => {
    const onCreated = vi.fn();
    render(ChannelCreateWizard, {
      props: { communikeyEvent: moderatedCommunity(), onClose: () => {}, onCreated }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(createGroupOnRelay).toHaveBeenCalledTimes(1));
    // CREATE lands on the FLAT host — the /c write guard rejects a create for
    // a group not yet in the subtree.
    expect(poolRelaySpy).toHaveBeenCalledWith(GROUP_RELAY);
    // NIP-29 Subgroups: same-host membership pointer becomes the channel's
    // `parent` — the relay auto-admits root-group members.
    const createArgs = createGroupOnRelay.mock.calls[0][0];
    expect(createArgs.metadata).toEqual(expect.objectContaining({ parent: 'root-1' }));
    // But the pointer + personal-list entry are ADDRESSED via the community's
    // /c/<rootId> endpoint so Armada shows one dedicated space per community.
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    expect(attachGroupChannel.mock.calls[0][0].pointer).toEqual(
      expect.objectContaining({ relay: `${GROUP_RELAY}c/root-1` })
    );
    await waitFor(() => expect(updatePersonalGroupsList).toHaveBeenCalledTimes(1));
    expect(updatePersonalGroupsList).toHaveBeenCalledWith(expect.anything(), {
      add: { id: 'new-group-id', relay: `${GROUP_RELAY}c/root-1` }
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('subsequent channel: existing /c pointers are unwrapped to the FLAT host for create, parent still set', async () => {
    // A community whose channels are ALREADY addressed via /c (the steady
    // state after the first channel) plus its membership pointer. sharedRelayOf
    // returns the /c URL, but create must still connect to the flat host and
    // the parent tag must still be set.
    const onCreated = vi.fn();
    const communikeyEvent = {
      kind: 10222,
      pubkey: PUBKEY,
      tags: [
        ['membership', 'root-1', GROUP_RELAY],
        ['group', 'chan-a', `${GROUP_RELAY}c/root-1`, 'General', 'members']
      ],
      content: ''
    };
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated }
    });
    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(createGroupOnRelay).toHaveBeenCalledTimes(1));
    // sharedRelayOf returned wss://groups.example/c/root-1, but flatGroupsRelay
    // unwrapped it → create connects to the flat host, not /c.
    expect(poolRelaySpy).toHaveBeenCalledWith(GROUP_RELAY);
    expect(createGroupOnRelay.mock.calls[0][0].metadata.parent).toBe('root-1');
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    expect(attachGroupChannel.mock.calls[0][0].pointer.relay).toBe(`${GROUP_RELAY}c/root-1`);
  });

  it('a membership pointer on a DIFFERENT relay than the channel never becomes parent', async () => {
    // The parent tag is relay-scoped per spec — a root group living
    // elsewhere is meaningless to this relay's Subgroups handling.
    const onCreated = vi.fn();
    const communikeyEvent = nip29Community([['membership', 'root-1', GROUP_RELAY_B]]);
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(createGroupOnRelay).toHaveBeenCalledTimes(1));
    const createArgs = createGroupOnRelay.mock.calls[0][0];
    expect(createArgs.metadata.parent).toBeUndefined();
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
    // members + worldReadable = world channel: open to self-join (bare 9021).
    expect(createArgs.metadata).toEqual(expect.objectContaining({ isPublic: true, isOpen: true }));
    expect(createArgs.user).toBe(mockManager.active);

    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    expect(attachGroupChannel.mock.calls[0][0].pointer).toEqual(
      expect.objectContaining({ access: 'members' })
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    // put-user built for the selected invitee.
    expect(buildPutUserTemplate).toHaveBeenCalledWith('new-group-id', MEMBER_B);
    // The creator's kind-10009 mirrors the fresh channel (r + group tags) —
    // that's what makes it visible in Armada/Flotilla.
    expect(updatePersonalGroupsList).toHaveBeenCalledWith(mockManager.active, {
      add: { id: 'new-group-id', relay: GROUP_RELAY }
    });
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

  // A4 ruling (final-review fix, 2026-08-19): a fresh members-tier channel no
  // longer seeds the community's existing member union at creation time —
  // members self-join via their own 9021. put-user goes out ONLY for
  // explicitly selected invitees (plus the admin pre-join, covered
  // separately below); no roster subscription is even consulted, so there is
  // nothing to wait for either.
  it('fans out put-user only to explicitly selected invitees for a members-tier create — no roster-union seeding', async () => {
    const communikeyEvent = nip29Community();
    render(ChannelCreateWizard, {
      props: { communikeyEvent, onClose: () => {}, onCreated: () => {} }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByTestId('wizard-access-members'));
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → final step
    // Create is never gated on any roster answer for a members-tier channel.
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByTestId('concord-wizard-create')).disabled
    ).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: new RegExp(MEMBER_B.slice(0, 12)) }));

    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledTimes(1));
    const putUserTargets = buildPutUserTemplate.mock.calls.map((args) => args[1]);
    // Exactly the explicitly selected invitee — no community-member union.
    expect(putUserTargets).toEqual([MEMBER_B]);
  });

  // Finding 3 (IMPORTANT): a createGroupOnRelay success followed by an
  // attachGroupChannel failure must not read as "creation failed" — the
  // group already exists on the relay, and a generic error toast invites a
  // retry that mints a second orphan. It gets its own warning toast naming
  // the id, the wizard stays open (no onCreated), and no put-user goes out.
  it('warns with the group id and keeps the wizard open when attach fails after the group is created', async () => {
    const communikeyEvent = nip29Community();
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

  // Task A3: root-group admins are pre-joined into every fresh channel — the
  // relay already made the CREATOR an admin at group-create time, so only
  // the OTHER admins need an explicit put-user (roster-fanout.js's
  // putUserOn/fanOut, same pattern as MembershipPane's fanOutNewMember).
  it('pre-joins root admins (except the creator) into the new channel with the admin role', async () => {
    const OTHER_ADMIN = 'd'.repeat(64);
    const onCreated = vi.fn();
    const communikeyEvent = nip29Community();
    render(ChannelCreateWizard, {
      props: {
        communikeyEvent,
        adminPubkeys: [mockManager.active.pubkey, OTHER_ADMIN],
        onClose: () => {},
        onCreated
      }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    // Default 'invited' tier — one Next reaches the final (invite/Create) step.
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-group-id'));

    const adminPutUserCalls = publishToGroupRelay.mock.calls.filter(
      ([, /** @type {any} */ template]) =>
        template.tags.some((/** @type {string[]} */ t) => t[0] === 'p' && t[2] === 'admin')
    );
    expect(adminPutUserCalls).toHaveLength(1);
    const [, template] = adminPutUserCalls[0];
    expect(template.tags).toContainEqual(['p', OTHER_ADMIN, 'admin']);
    expect(template.tags).toContainEqual(['h', 'new-group-id']);

    // The creator never gets a put-user of their own — the relay already
    // made them admin at group-create time.
    expect(
      publishToGroupRelay.mock.calls.some(([, /** @type {any} */ t]) =>
        t.tags.some(
          (/** @type {string[]} */ tag) =>
            tag[0] === 'p' && tag[1] === mockManager.active.pubkey && tag[2] === 'admin'
        )
      )
    ).toBe(false);
  });

  // Controller ruling: area_members_fanout_partial is worded for the OTHER
  // fan-out axis (one member across many channels — "{failed} of {total}
  // channels refused"); reusing it here would misreport admin failures as
  // channel failures. This axis (one channel across many admins) gets its
  // own key.
  it('warns with channel_admins_fanout_partial (not area_members_fanout_partial) when an admin put-user fails', async () => {
    const OK_ADMIN = 'd'.repeat(64);
    const FAILING_ADMIN = 'f'.repeat(64);
    const onCreated = vi.fn();
    const communikeyEvent = nip29Community();
    publishToGroupRelay.mockImplementation(
      async (/** @type {any} */ _conn, /** @type {any} */ template) => {
        const pTag = template.tags.find((/** @type {string[]} */ t) => t[0] === 'p');
        if (pTag?.[1] === FAILING_ADMIN) throw new Error('relay rejected');
        return {};
      }
    );

    render(ChannelCreateWizard, {
      props: {
        communikeyEvent,
        adminPubkeys: [mockManager.active.pubkey, OK_ADMIN, FAILING_ADMIN],
        onClose: () => {},
        onCreated
      }
    });

    const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
    await fireEvent.input(nameInput, { target: { value: 'Mathe' } });
    await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ }));
    await fireEvent.click(screen.getByTestId('concord-wizard-create'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-group-id'));

    const warningToast = toastSpy.mock.calls.find(([, type]) => type === 'warning');
    expect(warningToast).toBeTruthy();
    const [message] = /** @type {[string, string]} */ (warningToast);
    // "1 of 2 admins could not be added to the channel." — names ADMINS as
    // the failed/total axis, never area_members_fanout_partial's "{failed}
    // of {total} channels refused" wording (which would misreport 1 failed
    // ADMIN as 1 failed CHANNEL out of 2).
    expect(message.toLowerCase()).toContain('admin');
    expect(message.toLowerCase()).not.toContain('refused');
    expect(message.toLowerCase()).not.toContain('abgelehnt');
  });
});
