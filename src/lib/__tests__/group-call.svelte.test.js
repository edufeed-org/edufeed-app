// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * group-call.svelte.js — the single active NIP-29 group call. Owns the
 * token round-trip, which channel the call belongs to AND the LiveKit
 * connection itself: the call outlives the channel view (navigating away
 * leaves it running in the dock), so no component may own the Room.
 * One call at a time app-wide (the connection service holds one Room).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestGroupCallToken = vi.fn();
vi.mock('$lib/groups/livekit.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    requestGroupCallToken: (/** @type {any[]} */ ...args) => requestGroupCallToken(...args)
  };
});

const disconnectFromRoom = vi.fn(async () => {});
const connectToRoom = vi.fn(async () => {});
// The store's one disconnect listener (onRoomDisconnected), so a test can
// play "the server dropped / removed us".
const lkListener = { cb: /** @type {((reason: any) => void) | null} */ (null) };
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  disconnectFromRoom: () => disconnectFromRoom(),
  connectToRoom: (/** @type {any[]} */ ...args) => connectToRoom(...args),
  onRoomDisconnected: (/** @type {(reason: any) => void} */ cb) => {
    lkListener.cb = cb;
    return () => {
      if (lkListener.cb === cb) lkListener.cb = null;
    };
  },
  isRemovalReason: (/** @type {any} */ reason) => reason === 'removed-reason'
}));

vi.mock('$lib/paraglide/messages', () => ({
  groups_call_error_unauthorized: () => 'unauthorized-msg',
  groups_call_error_forbidden: () => 'forbidden-msg',
  groups_call_error_not_enabled: () => 'not-enabled-msg',
  groups_call_error_generic: () => 'generic-msg',
  groups_call_error_pass: () => 'pass-msg',
  groups_call_error_removed: () => 'removed-msg'
}));

const confirmCallSwitch = vi.fn();
vi.mock('$lib/groups/call-switch-confirm.svelte.js', () => ({
  confirmCallSwitch: (/** @type {any[]} */ ...args) => confirmCallSwitch(...args)
}));

const { GroupCallTokenError } = await import('$lib/groups/livekit.js');
const {
  getGroupCallState,
  joinGroupCall,
  joinGroupCallWithConfirm,
  leaveGroupCall,
  callErrorMessage,
  registerCallStageView,
  showCallStage,
  hideCallStage,
  toggleChatBeside
} = await import('$lib/groups/group-call.svelte.js');

const RELAY = 'wss://groups.example/';
const P1 = { id: 'room-1', relay: RELAY };
const P2 = { id: 'room-2', relay: RELAY };
const USER = { pubkey: 'a'.repeat(64), signer: { signEvent: vi.fn() } };

beforeEach(async () => {
  await leaveGroupCall();
  requestGroupCallToken.mockReset();
  disconnectFromRoom.mockClear();
  connectToRoom.mockReset();
  connectToRoom.mockResolvedValue(undefined);
  confirmCallSwitch.mockReset();
});

describe('joinGroupCall', () => {
  it('starts idle', () => {
    const s = getGroupCallState();
    expect(s.phase).toBe('idle');
    expect(s.activeKey).toBeNull();
  });

  it('requests a token for the pointer and becomes ready with token + server url', async () => {
    let resolve;
    requestGroupCallToken.mockReturnValue(new Promise((r) => (resolve = r)));
    const s = getGroupCallState();

    const pending = joinGroupCall(P1, USER);
    expect(s.phase).toBe('requesting');
    expect(s.activeKey).not.toBeNull();
    expect(requestGroupCallToken).toHaveBeenCalledWith(RELAY, 'room-1', USER, { code: undefined });

    resolve({ serverUrl: 'wss://livekit.example', participantToken: 'jwt' });
    await pending;
    expect(s.phase).toBe('ready');
    expect(s.serverUrl).toBe('wss://livekit.example');
    expect(s.token).toBe('jwt');
  });

  it('keys the call by channel so the chat can tell "in call here" from "in call elsewhere"', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCall(P1, USER);
    const s = getGroupCallState();
    expect(s.activeKey).toBeTruthy();
    expect(s.isActiveFor(P1)).toBe(true);
    expect(s.isActiveFor(P2)).toBe(false);
  });

  it('records a token error with the failing channel still active so the UI can offer retry', async () => {
    const err = new GroupCallTokenError('forbidden', 'not allowed', 403);
    requestGroupCallToken.mockRejectedValue(err);
    await joinGroupCall(P1, USER);
    const s = getGroupCallState();
    expect(s.phase).toBe('error');
    expect(s.error).toBe(err);
    expect(s.isActiveFor(P1)).toBe(true);
    expect(s.token).toBeNull();
  });

  it('joining another channel disconnects the current call first', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCall(P1, USER);
    await joinGroupCall(P2, USER);
    expect(disconnectFromRoom).toHaveBeenCalledTimes(1);
    const s = getGroupCallState();
    expect(s.isActiveFor(P2)).toBe(true);
    expect(s.isActiveFor(P1)).toBe(false);
  });

  it('ignores a stale token answer after the user already left', async () => {
    let resolve;
    requestGroupCallToken.mockReturnValue(new Promise((r) => (resolve = r)));
    const pending = joinGroupCall(P1, USER);
    await leaveGroupCall();
    resolve({ serverUrl: 'wss://x', participantToken: 't' });
    await pending;
    const s = getGroupCallState();
    expect(s.phase).toBe('idle');
    expect(s.token).toBeNull();
  });
});

describe('connection ownership', () => {
  it('connects the one Room as soon as the token is in, joining muted', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    await joinGroupCall(P1, USER);
    expect(connectToRoom).toHaveBeenCalledTimes(1);
    expect(connectToRoom).toHaveBeenCalledWith('jwt', 'wss://lk', {});
  });

  // `phase` flips to 'ready' as soon as the TOKEN is in, before LiveKit has
  // actually connected — CallLanding's "was the guest ever really in the
  // call" check must not rely on phase alone (a failed connect would then
  // look identical to a successful one). `connected` closes that gap.
  it('is not connected while the token request is in flight, becomes connected once connectToRoom resolves, and disconnects on leave', async () => {
    let resolveToken;
    requestGroupCallToken.mockReturnValue(new Promise((r) => (resolveToken = r)));
    let resolveConnect;
    connectToRoom.mockReturnValueOnce(new Promise((r) => (resolveConnect = r)));
    const s = getGroupCallState();

    const pending = joinGroupCall(P1, USER);
    expect(s.connected).toBe(false);

    resolveToken({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    await vi.waitFor(() => expect(s.phase).toBe('ready'));
    // Token is in and phase is 'ready', but LiveKit hasn't connected yet.
    expect(s.connected).toBe(false);

    resolveConnect();
    await pending;
    expect(s.connected).toBe(true);

    await leaveGroupCall();
    expect(s.connected).toBe(false);
  });

  it('never reports connected after a failed connect', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    connectToRoom.mockRejectedValueOnce(new Error('could not establish pc connection'));
    await joinGroupCall(P1, USER);
    expect(getGroupCallState().connected).toBe(false);
  });

  it('re-joining the channel that is already in a call does not reconnect', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    await joinGroupCall(P1, USER);
    await joinGroupCall(P1, USER);
    expect(connectToRoom).toHaveBeenCalledTimes(1);
  });

  it('a failed connect becomes an error the UI can retry', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    connectToRoom.mockRejectedValueOnce(new Error('could not establish pc connection'));
    await joinGroupCall(P1, USER);
    const s = getGroupCallState();
    expect(s.phase).toBe('error');
    expect(s.isActiveFor(P1)).toBe(true);
  });

  it('a connect that completes after the user left is torn down again', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    let finish;
    connectToRoom.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const pending = joinGroupCall(P1, USER);
    await vi.waitFor(() => expect(connectToRoom).toHaveBeenCalled());
    await leaveGroupCall();
    disconnectFromRoom.mockClear();
    finish();
    await pending;
    expect(disconnectFromRoom).toHaveBeenCalledTimes(1);
    expect(getGroupCallState().phase).toBe('idle');
  });

  it('remembers the title and the page to return to (for the dock)', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    await joinGroupCall(P1, USER, { title: 'Standup', href: '/groups/abc' });
    const s = getGroupCallState();
    expect(s.title).toBe('Standup');
    expect(s.href).toBe('/groups/abc');
    await leaveGroupCall();
    expect(s.title).toBe('');
    expect(s.href).toBeNull();
  });
});

describe('stage views', () => {
  it('counts mounted stage views so the dock only shows when none is on screen', () => {
    const s = getGroupCallState();
    expect(s.stageViews).toBe(0);
    const offA = registerCallStageView();
    const offB = registerCallStageView();
    expect(s.stageViews).toBe(2);
    offA();
    offA();
    expect(s.stageViews).toBe(1);
    offB();
    expect(s.stageViews).toBe(0);
  });

  it('a stage view records the page it is on as the way back', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    await joinGroupCall(P1, USER, { title: 'Standup', href: '/c/x' });
    const off = registerCallStageView('/c/x?view=channels&channel=room-1');
    expect(getGroupCallState().href).toBe('/c/x?view=channels&channel=room-1');
    off();
  });

  it('the stage can be stepped away from (chat while in the call) and back', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 'jwt' });
    await joinGroupCall(P1, USER);
    const s = getGroupCallState();
    expect(s.stageHidden).toBe(false);
    hideCallStage();
    expect(s.stageHidden).toBe(true);
    showCallStage();
    expect(s.stageHidden).toBe(false);
    hideCallStage();
    await leaveGroupCall();
    expect(s.stageHidden).toBe(false);
  });

  // Wide screens: the chat opens as a column beside the stage instead of
  // replacing it; the choice is a per-device preference.
  it('toggles the chat beside the stage and remembers it on this device', () => {
    const s = getGroupCallState();
    // Open by default on wide screens (QA C3).
    expect(s.chatBeside).toBe(true);
    toggleChatBeside();
    expect(s.chatBeside).toBe(false);
    expect(localStorage.getItem('edufeed:call:chatBeside')).toBe('0');
    toggleChatBeside();
    expect(s.chatBeside).toBe(true);
    expect(localStorage.getItem('edufeed:call:chatBeside')).toBe('1');
  });
});

describe('leaveGroupCall', () => {
  it('disconnects the room and resets to idle', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCall(P1, USER);
    await leaveGroupCall();
    const s = getGroupCallState();
    expect(disconnectFromRoom).toHaveBeenCalledTimes(1);
    expect(s.phase).toBe('idle');
    expect(s.activeKey).toBeNull();
    expect(s.error).toBeNull();
  });
});

// Task M6: every member join entry point goes through this instead of
// `joinGroupCall` directly, so the "switch calls?" dialog is implemented
// once, here.
describe('joinGroupCallWithConfirm', () => {
  it('joins straight away while idle (no call anywhere)', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCallWithConfirm(P1, USER);
    expect(confirmCallSwitch).not.toHaveBeenCalled();
    expect(getGroupCallState().isActiveFor(P1)).toBe(true);
  });

  it('joins straight away when re-joining the SAME channel already live', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCallWithConfirm(P1, USER);
    await joinGroupCallWithConfirm(P1, USER);
    expect(confirmCallSwitch).not.toHaveBeenCalled();
    expect(connectToRoom).toHaveBeenCalledTimes(1);
  });

  it('asks before switching away from a LIVE call in a different channel', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCallWithConfirm(P1, USER);
    confirmCallSwitch.mockResolvedValue(true);

    await joinGroupCallWithConfirm(P2, USER, { title: 'Standup' });

    expect(confirmCallSwitch).toHaveBeenCalledTimes(1);
    // The dialog names the call the user is CURRENTLY in, not the target.
    expect(confirmCallSwitch).toHaveBeenCalledWith('');
    expect(disconnectFromRoom).toHaveBeenCalledTimes(1);
    expect(getGroupCallState().isActiveFor(P2)).toBe(true);
  });

  it("passes the current call's title to the confirm dialog", async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCallWithConfirm(P1, USER, { title: 'Standup' });
    confirmCallSwitch.mockResolvedValue(true);
    await joinGroupCallWithConfirm(P2, USER);
    expect(confirmCallSwitch).toHaveBeenCalledWith('Standup');
  });

  it('cancelling leaves the current call untouched and does not join', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCallWithConfirm(P1, USER);
    confirmCallSwitch.mockResolvedValue(false);

    await joinGroupCallWithConfirm(P2, USER);

    expect(disconnectFromRoom).not.toHaveBeenCalled();
    const s = getGroupCallState();
    expect(s.isActiveFor(P1)).toBe(true);
    expect(s.isActiveFor(P2)).toBe(false);
    expect(s.phase).toBe('ready');
  });

  it('does not ask once the previous call ended on its own', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
    await joinGroupCallWithConfirm(P1, USER);
    lkListener.cb?.('removed-reason');
    expect(getGroupCallState().phase).toBe('ended');

    await joinGroupCallWithConfirm(P2, USER);

    expect(confirmCallSwitch).not.toHaveBeenCalled();
    expect(getGroupCallState().isActiveFor(P2)).toBe(true);
  });

  it('does not ask once the previous call errored', async () => {
    requestGroupCallToken.mockResolvedValueOnce({ serverUrl: 'wss://x', participantToken: 't' });
    connectToRoom.mockRejectedValueOnce(new Error('boom'));
    await joinGroupCallWithConfirm(P1, USER);
    expect(getGroupCallState().phase).toBe('error');

    requestGroupCallToken.mockResolvedValueOnce({ serverUrl: 'wss://x', participantToken: 't2' });
    await joinGroupCallWithConfirm(P2, USER);

    expect(confirmCallSwitch).not.toHaveBeenCalled();
    expect(getGroupCallState().isActiveFor(P2)).toBe(true);
  });
});

describe('callErrorMessage', () => {
  it.each([
    ['unauthorized', 'unauthorized-msg'],
    ['forbidden', 'forbidden-msg'],
    ['not-enabled', 'not-enabled-msg'],
    ['removed', 'removed-msg'],
    ['server', 'generic-msg'],
    ['network', 'generic-msg']
  ])('maps reason %s', (reason, expected) => {
    expect(callErrorMessage(new GroupCallTokenError(reason, 'x'))).toBe(expected);
  });
  it('maps a plain Error to the generic message', () => {
    expect(callErrorMessage(new Error('boom'))).toBe('generic-msg');
  });
});

describe('call pass code', () => {
  it('passes the code to the token request and keeps it for retry', async () => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://lk', participantToken: 't' });
    await joinGroupCall(P1, USER, { title: 'x', code: 'C'.repeat(22) });
    expect(requestGroupCallToken).toHaveBeenCalledWith(RELAY, 'room-1', USER, {
      code: 'C'.repeat(22)
    });
    expect(getGroupCallState().code).toBe('C'.repeat(22));
    await leaveGroupCall();
    expect(getGroupCallState().code).toBeNull();
  });
  it('explains a refused pass', () => {
    expect(callErrorMessage(new GroupCallTokenError('pass', 'call pass expired', 403))).toBe(
      'pass-msg'
    );
  });
});

// Live 2026-10-01: a revoked pass made the relay remove the guest; LiveKit
// said 'disconnected' but the store stayed 'ready' and the stage spun on
// "Connecting…" forever.
describe('server-side end of the call', () => {
  beforeEach(() => {
    requestGroupCallToken.mockResolvedValue({ serverUrl: 'wss://x', participantToken: 't' });
  });

  it('a removal ends the call with endReason "removed", keeping the channel active', async () => {
    await joinGroupCall(P1, USER);
    const s = getGroupCallState();
    expect(s.connected).toBe(true);
    lkListener.cb?.('removed-reason');
    expect(s.phase).toBe('ended');
    expect(s.endReason).toBe('removed');
    expect(s.connected).toBe(false);
    expect(s.isActiveFor(P1)).toBe(true);
  });

  it('any other unexpected disconnect ends it as "dropped"', async () => {
    await joinGroupCall(P1, USER);
    lkListener.cb?.('signal-close');
    const s = getGroupCallState();
    expect(s.phase).toBe('ended');
    expect(s.endReason).toBe('dropped');
  });

  it('leaving resets the ended state and stops listening', async () => {
    await joinGroupCall(P1, USER);
    lkListener.cb?.('removed-reason');
    await leaveGroupCall();
    const s = getGroupCallState();
    expect(s.phase).toBe('idle');
    expect(s.endReason).toBeNull();
    expect(lkListener.cb).toBeNull();
  });

  it('rejoining after the end connects again and clears endReason', async () => {
    await joinGroupCall(P1, USER);
    lkListener.cb?.('signal-close');
    await joinGroupCall(P1, USER);
    const s = getGroupCallState();
    expect(connectToRoom).toHaveBeenCalledTimes(2);
    expect(s.phase).toBe('ready');
    expect(s.connected).toBe(true);
    expect(s.endReason).toBeNull();
  });

  it('a disconnect reported for an attempt the user already left is ignored', async () => {
    await joinGroupCall(P1, USER);
    const stale = lkListener.cb;
    await leaveGroupCall();
    await joinGroupCall(P2, USER);
    stale?.('removed-reason');
    expect(getGroupCallState().phase).toBe('ready');
  });
});
