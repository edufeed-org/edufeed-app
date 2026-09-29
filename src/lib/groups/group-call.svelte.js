// The single active NIP-29 group call.
//
// Owns the token round-trip (groups/livekit.js) and WHICH channel the call
// belongs to; the stage component (components/groups/call/GroupCallStage)
// does the actual LiveKit connect with the token it is handed and
// disconnects when it unmounts. One call at a time app-wide — the
// connection service holds exactly one Room, and this module mirrors that.
//
// Deliberately no static import of livekit-connection.svelte.js: that module
// pulls livekit-client (~300KB) into whatever imports it, and this store is
// imported by GroupChat, which sits in the /groups and /c route graphs. The
// only thing needed outside the stage is the safety-net disconnect on leave,
// loaded on demand.
import { channelKey } from './community-pointer.js';
import { requestGroupCallToken, GroupCallTokenError } from './livekit.js';
import * as m from '$lib/paraglide/messages';

/** @typedef {'idle' | 'requesting' | 'ready' | 'error'} GroupCallPhase */

/** @type {string | null} */
let activeKey = $state(null);
/** @type {GroupCallPhase} */
let phase = $state('idle');
/** @type {Error | null} */
let error = $state(null);
/** @type {string | null} */
let serverUrl = $state(null);
/** @type {string | null} */
let token = $state(null);
// Bumped on every join/leave so a token that lands after the user already
// left (or joined elsewhere) is dropped instead of reviving the old call.
let attempt = 0;

/**
 * @returns {{
 *   activeKey: string | null,
 *   phase: GroupCallPhase,
 *   error: Error | null,
 *   serverUrl: string | null,
 *   token: string | null,
 *   isActiveFor: (pointer: {id?: string, relay?: string} | null | undefined) => boolean
 * }}
 */
export function getGroupCallState() {
  return {
    get activeKey() {
      return activeKey;
    },
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    get serverUrl() {
      return serverUrl;
    },
    get token() {
      return token;
    },
    isActiveFor(pointer) {
      const key = channelKey(pointer ?? {});
      return !!key && key === activeKey;
    }
  };
}

/**
 * Request a token for this channel and mark it the active call. Joining a
 * different channel leaves the current one first; re-joining the channel
 * that is already ready is a no-op; re-joining after an error retries.
 * @param {{id: string, relay: string}} pointer
 * @param {{pubkey: string, signer: any}} user
 */
export async function joinGroupCall(pointer, user) {
  const key = channelKey(pointer);
  if (!key || !user?.signer) return;
  if (activeKey && activeKey !== key) await leaveGroupCall();
  if (activeKey === key && phase === 'ready') return;

  const myAttempt = ++attempt;
  activeKey = key;
  phase = 'requesting';
  error = null;
  token = null;
  serverUrl = null;
  try {
    const result = await requestGroupCallToken(pointer.relay, pointer.id, user);
    if (myAttempt !== attempt) return;
    serverUrl = result.serverUrl;
    token = result.participantToken;
    phase = 'ready';
  } catch (err) {
    if (myAttempt !== attempt) return;
    error = err instanceof Error ? err : new Error(String(err));
    phase = 'error';
  }
}

/** Reset to idle and make sure no Room is left connected. */
export async function leaveGroupCall() {
  attempt++;
  const wasActive = activeKey !== null;
  activeKey = null;
  phase = 'idle';
  error = null;
  token = null;
  serverUrl = null;
  if (wasActive) {
    const { disconnectFromRoom } = await import('$lib/services/livekit-connection.svelte.js');
    await disconnectFromRoom();
  }
}

/**
 * The user-facing line for a failed join.
 * @param {unknown} err
 * @returns {string}
 */
export function callErrorMessage(err) {
  const reason = err instanceof GroupCallTokenError ? err.reason : null;
  switch (reason) {
    case 'unauthorized':
      return m.groups_call_error_unauthorized();
    case 'forbidden':
      return m.groups_call_error_forbidden();
    case 'not-enabled':
      return m.groups_call_error_not_enabled();
    default:
      return m.groups_call_error_generic();
  }
}
