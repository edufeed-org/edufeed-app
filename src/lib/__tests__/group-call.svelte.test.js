/** @vitest-environment jsdom */
/**
 * group-call.svelte.js — the single active NIP-29 group call. Owns the
 * token round-trip and which channel the call belongs to; the stage
 * component does the actual LiveKit connect with the token it is handed.
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
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  disconnectFromRoom: () => disconnectFromRoom()
}));

vi.mock('$lib/paraglide/messages', () => ({
  groups_call_error_unauthorized: () => 'unauthorized-msg',
  groups_call_error_forbidden: () => 'forbidden-msg',
  groups_call_error_not_enabled: () => 'not-enabled-msg',
  groups_call_error_generic: () => 'generic-msg'
}));

const { GroupCallTokenError } = await import('$lib/groups/livekit.js');
const { getGroupCallState, joinGroupCall, leaveGroupCall, callErrorMessage } = await import(
  '$lib/groups/group-call.svelte.js'
);

const RELAY = 'wss://groups.example/';
const P1 = { id: 'room-1', relay: RELAY };
const P2 = { id: 'room-2', relay: RELAY };
const USER = { pubkey: 'a'.repeat(64), signer: { signEvent: vi.fn() } };

beforeEach(async () => {
  await leaveGroupCall();
  requestGroupCallToken.mockReset();
  disconnectFromRoom.mockClear();
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
    expect(requestGroupCallToken).toHaveBeenCalledWith(RELAY, 'room-1', USER);

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

describe('callErrorMessage', () => {
  it.each([
    ['unauthorized', 'unauthorized-msg'],
    ['forbidden', 'forbidden-msg'],
    ['not-enabled', 'not-enabled-msg'],
    ['server', 'generic-msg'],
    ['network', 'generic-msg']
  ])('maps reason %s', (reason, expected) => {
    expect(callErrorMessage(new GroupCallTokenError(reason, 'x'))).toBe(expected);
  });
  it('maps a plain Error to the generic message', () => {
    expect(callErrorMessage(new Error('boom'))).toBe('generic-msg');
  });
});
