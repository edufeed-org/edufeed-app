// A reactive stand-in for services/livekit-connection.svelte.js as the
// breakout store uses it: the breakout-topic listener and the participant-
// joined listener it registers, the data messages it sends, and the bits of
// connection state it reads (our seat and its metadata version, the last
// disconnect reason). Tests drive all of it from here.
import { vi } from 'vitest';

/** @type {((raw: unknown, sender: any) => void) | null} */
export let breakoutListener = null;
/** @type {((participant: {identity: string, metadata?: string}) => void) | null} */
export let joinedListener = null;

let identity = $state('b'.repeat(64) + ':seat1');
let metadata = $state('');
let participantMetadataVersion = $state(0);
/** @type {number | null} */
let disconnectReason = $state(null);

export const sendBreakoutMessage = vi.fn(async () => {});
/** The local system line a call broadcast adds to the chat. */
export const addSystemCallChat = vi.fn(() => null);

/** @param {(raw: unknown, sender: any) => void} cb */
export function onBreakoutMessage(cb) {
  breakoutListener = cb;
  return () => {
    if (breakoutListener === cb) breakoutListener = null;
  };
}

/** @param {(participant: {identity: string, metadata?: string}) => void} cb */
export function onParticipantJoined(cb) {
  joinedListener = cb;
  return () => {
    if (joinedListener === cb) joinedListener = null;
  };
}

export function getLiveKitState() {
  return {
    get localParticipant() {
      return { identity, metadata };
    },
    get participantMetadataVersion() {
      return participantMetadataVersion;
    },
    get disconnectReason() {
      return disconnectReason;
    }
  };
}

// livekit-client's DisconnectReason numbers
export const PARTICIPANT_REMOVED = 4;
export const ROOM_DELETED = 5;
export const isRemovalReason = (/** @type {unknown} */ r) =>
  r === PARTICIPANT_REMOVED || r === ROOM_DELETED;
export const isRoomDeletedReason = (/** @type {unknown} */ r) => r === ROOM_DELETED;

/** Our seat's identity. @param {string} next */
export function setIdentity(next) {
  identity = next;
}

/** The relay (re)wrote our seat's metadata — a role change. @param {string} next */
export function setMyMetadata(next) {
  metadata = next;
  participantMetadataVersion++;
}

/** @param {number | null} reason */
export function setDisconnectReason(reason) {
  disconnectReason = reason;
}

export function resetLiveKitFake() {
  identity = 'b'.repeat(64) + ':seat1';
  metadata = '';
  disconnectReason = null;
  sendBreakoutMessage.mockClear();
  addSystemCallChat.mockClear();
}
