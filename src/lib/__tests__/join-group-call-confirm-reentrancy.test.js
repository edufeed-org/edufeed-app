// @ts-nocheck
/**
 * joinGroupCallWithConfirm + the REAL confirmCallSwitch together (Task M6,
 * review fix round 1). Unlike group-call.svelte.test.js (which mocks
 * confirmCallSwitch to test the gating logic in isolation), this file
 * exercises the actual modal-store-backed confirm to prove the reentrancy
 * fix end to end: a caller that guards its join with a `busy` flag (e.g.
 * ChannelCallRoster) must have that flag released for BOTH an overlapping
 * attempt that gets superseded and the one that wins — neither Promise may
 * hang forever.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modalStore } from '$lib/stores/modal.svelte.js';

const requestGroupCallToken = vi.fn();
vi.mock('$lib/groups/livekit.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    requestGroupCallToken: (/** @type {any[]} */ ...args) => requestGroupCallToken(...args)
  };
});
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  disconnectFromRoom: async () => {},
  connectToRoom: async () => {},
  onRoomDisconnected: () => () => {},
  isRemovalReason: () => false
}));
vi.mock('$lib/paraglide/messages', () => ({}));

const { getGroupCallState, joinGroupCallWithConfirm, leaveGroupCall } = await import(
  '$lib/groups/group-call.svelte.js'
);

const RELAY = 'wss://groups.example/';
const P1 = { id: 'room-1', relay: RELAY };
const P2 = { id: 'room-2', relay: RELAY };
const P3 = { id: 'room-3', relay: RELAY };
const USER = { pubkey: 'a'.repeat(64), signer: { signEvent: vi.fn() } };

/** A ChannelCallRoster-style guarded join: busy until the whole thing settles. */
function guardedJoin(holder, pointer) {
  holder.busy = true;
  return joinGroupCallWithConfirm(pointer, USER).finally(() => {
    holder.busy = false;
  });
}

/** The pre-join lobby (real confirmCallJoin) is the last gate before the token. */
async function answerLobby(media = { audio: false, video: false }) {
  await vi.waitFor(() => expect(modalStore.activeModal).toBe('callPreJoin'));
  modalStore.modalCallbacks.onConfirm(media);
}

beforeEach(async () => {
  await leaveGroupCall();
  modalStore.closeModal();
  requestGroupCallToken.mockReset();
  requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 't' });
});

describe('joinGroupCallWithConfirm reentrancy (real confirmCallSwitch)', () => {
  it('a superseded confirm resolves false and releases its caller’s busy flag', async () => {
    const first = joinGroupCallWithConfirm(P1, USER, { title: 'Standup' });
    await answerLobby();
    await first;
    expect(getGroupCallState().isActiveFor(P1)).toBe(true);

    const callerA = { busy: false };
    const callerB = { busy: false };
    const pendingA = guardedJoin(callerA, P2);
    const pendingB = guardedJoin(callerB, P3);

    // Caller A's confirm was superseded by B's — it must settle (false), not
    // hang, and its busy flag must come back down.
    await pendingA;
    expect(callerA.busy).toBe(false);
    expect(getGroupCallState().isActiveFor(P1)).toBe(true);

    // Caller B's confirm is the one left live; answering it still works —
    // the lobby follows the switch confirm, then the token is requested.
    modalStore.modalCallbacks.onConfirm();
    await answerLobby({ audio: true, video: false });
    await pendingB;
    expect(callerB.busy).toBe(false);
    expect(getGroupCallState().isActiveFor(P3)).toBe(true);
  });

  // The lobby shares the one modal slot: a second join attempt while a lobby
  // is open settles the first as cancelled instead of orphaning its caller.
  it('a superseded lobby settles as cancelled and releases its caller’s busy flag', async () => {
    const callerA = { busy: false };
    const callerB = { busy: false };
    const pendingA = guardedJoin(callerA, P1);
    await vi.waitFor(() => expect(modalStore.activeModal).toBe('callPreJoin'));
    const pendingB = guardedJoin(callerB, P2);
    await pendingA;
    expect(callerA.busy).toBe(false);
    expect(requestGroupCallToken).not.toHaveBeenCalled();
    await answerLobby();
    await pendingB;
    expect(callerB.busy).toBe(false);
    expect(getGroupCallState().isActiveFor(P2)).toBe(true);
    expect(requestGroupCallToken).toHaveBeenCalledTimes(1);
  });

  it('a cancelled lobby joins nothing and releases the busy flag', async () => {
    const caller = { busy: false };
    const pending = guardedJoin(caller, P1);
    await vi.waitFor(() => expect(modalStore.activeModal).toBe('callPreJoin'));
    modalStore.modalCallbacks.onCancel();
    await pending;
    expect(caller.busy).toBe(false);
    expect(getGroupCallState().phase).toBe('idle');
    expect(requestGroupCallToken).not.toHaveBeenCalled();
  });
});
