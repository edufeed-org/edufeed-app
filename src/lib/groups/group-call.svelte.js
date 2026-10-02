// The single active NIP-29 group call.
//
// Owns the token round-trip (groups/livekit.js), WHICH channel the call
// belongs to, and the LiveKit connection itself. The call outlives the
// channel view: navigating away keeps it running and the app-level CallDock
// takes over, so no component may own the Room — the stage
// (components/groups/call/GroupCallStage) is a pure view that registers
// itself (registerCallStageView) so the dock knows when to step aside.
// One call at a time app-wide — the connection service holds exactly one
// Room, and this module mirrors that.
//
// Deliberately no static import of livekit-connection.svelte.js: that module
// pulls livekit-client (~300KB) into whatever imports it, and this store is
// imported by GroupChat and the root layout. It is loaded on join.
import { channelKey } from './community-pointer.js';
import { requestGroupCallToken, GroupCallTokenError } from './livekit.js';
import { getChatBeside, setChatBeside } from '$lib/services/call-prefs.js';
import * as m from '$lib/paraglide/messages';

/** @typedef {'idle' | 'requesting' | 'ready' | 'error' | 'ended'} GroupCallPhase */
/** @typedef {'removed' | 'dropped'} GroupCallEndReason */

/** @type {string | null} */
let activeKey = $state(null);
/** @type {GroupCallPhase} */
let phase = $state('idle');
// `phase` becomes 'ready' as soon as the token is in — BEFORE LiveKit has
// actually connected. A page that needs to know "did this guest really end
// up in the call" (CallLanding's post-call screen) must check `connected`,
// not `phase`, or a join whose token succeeds but whose handshake then
// fails looks identical to a real join.
let connected = $state(false);
/** @type {Error | null} */
let error = $state(null);
// Why the call ended on its own (phase 'ended'): the server took us out
// (revoked call pass, kick, deleted room) or the connection was lost.
// The channel stays active (activeKey) until the user leaves or rejoins.
/** @type {GroupCallEndReason | null} */
let endReason = $state(null);
/** @type {string | null} */
let serverUrl = $state(null);
/** @type {string | null} */
let token = $state(null);
// For the dock: what to call the call, and which page to return to.
let title = $state('');
/** @type {string | null} */
let href = $state(null);
// The call pass code (if the active call was joined as a guest) — kept so
// a retry after a failed token request can reuse it.
/** @type {string | null} */
let code = $state(null);
// Mounted stage views (the dock shows while none is on screen) and whether
// the user stepped from the stage back to the chat while staying in the call.
let stageViews = $state(0);
let stageHidden = $state(false);
// Wide screens: the chat as a column beside the stage (per-device pref).
let chatBeside = $state(getChatBeside());
// Bumped on every join/leave so a token that lands after the user already
// left (or joined elsewhere) is dropped instead of reviving the old call.
let attempt = 0;
// Unsubscribe of the connection service's disconnect listener for the
// current attempt. Plain `let`: bookkeeping, never rendered.
/** @type {(() => void) | null} */
let stopDisconnectListener = null;

/**
 * @returns {{
 *   activeKey: string | null,
 *   phase: GroupCallPhase,
 *   error: Error | null,
 *   endReason: GroupCallEndReason | null,
 *   serverUrl: string | null,
 *   token: string | null,
 *   title: string,
 *   href: string | null,
 *   code: string | null,
 *   stageViews: number,
 *   stageHidden: boolean,
 *   chatBeside: boolean,
 *   connected: boolean,
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
    get connected() {
      return connected;
    },
    get error() {
      return error;
    },
    get endReason() {
      return endReason;
    },
    get serverUrl() {
      return serverUrl;
    },
    get token() {
      return token;
    },
    get title() {
      return title;
    },
    get href() {
      return href;
    },
    get code() {
      return code;
    },
    get stageViews() {
      return stageViews;
    },
    get stageHidden() {
      return stageHidden;
    },
    get chatBeside() {
      return chatBeside;
    },
    isActiveFor(pointer) {
      const key = channelKey(pointer ?? {});
      return !!key && key === activeKey;
    }
  };
}

/**
 * Request a token for this channel, mark it the active call and connect.
 * Joining a different channel leaves the current one first; re-joining the
 * channel that is already in a call is a no-op (it only brings the stage
 * back); re-joining after an error retries. Joins muted, camera off.
 * @param {{id: string, relay: string}} pointer
 * @param {{pubkey: string, signer: any}} user
 * @param {{title?: string, href?: string | null, code?: string}} [view] for the dock
 */
export async function joinGroupCall(pointer, user, view = {}) {
  const key = channelKey(pointer);
  if (!key || !user?.signer) return;
  if (activeKey && activeKey !== key) await leaveGroupCall();
  stageHidden = false;
  if (activeKey === key && (phase === 'ready' || phase === 'requesting')) return;

  const myAttempt = ++attempt;
  activeKey = key;
  phase = 'requesting';
  error = null;
  endReason = null;
  token = null;
  serverUrl = null;
  connected = false;
  title = view.title ?? '';
  href = view.href ?? null;
  code = view.code ?? null;
  try {
    const result = await requestGroupCallToken(pointer.relay, pointer.id, user, {
      code: view.code
    });
    if (myAttempt !== attempt) return;
    serverUrl = result.serverUrl;
    token = result.participantToken;
    phase = 'ready';
    const lk = await import('$lib/services/livekit-connection.svelte.js');
    if (myAttempt !== attempt) return;
    // The server (or the network) ending the seat: show a readable end
    // state instead of a stage stuck on "Connecting…".
    stopDisconnectListener?.();
    stopDisconnectListener = lk.onRoomDisconnected((reason) => {
      if (myAttempt !== attempt) return;
      connected = false;
      phase = 'ended';
      endReason = lk.isRemovalReason(reason) ? 'removed' : 'dropped';
    });
    await lk.connectToRoom(result.participantToken, result.serverUrl, {});
    // Left (or moved on) while the handshake ran: leaveGroupCall's
    // disconnect raced the connect, so tear the fresh Room down again.
    if (myAttempt !== attempt) {
      await lk.disconnectFromRoom();
    } else {
      connected = true;
    }
  } catch (err) {
    if (myAttempt !== attempt) return;
    console.error('Failed to join call:', err);
    error = err instanceof Error ? err : new Error(String(err));
    phase = 'error';
    connected = false;
  }
}

/**
 * A stage view is on screen; returns the matching unregister (idempotent).
 * `viewHref` is the page it sits on: the dock's "back to call" returns to
 * wherever the call was last shown (a channel opened from a list may reach
 * its final URL only after the join started).
 * @param {string} [viewHref]
 * @returns {() => void}
 */
export function registerCallStageView(viewHref) {
  stageViews++;
  if (viewHref && activeKey) href = viewHref;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    stageViews--;
  };
}

/** Step from the stage back to the channel's chat, staying in the call. */
export function hideCallStage() {
  stageHidden = true;
}

/** Wide screens: open / close the chat as a column beside the stage. */
export function toggleChatBeside() {
  chatBeside = !chatBeside;
  setChatBeside(chatBeside);
}

/** Bring the stage back (dock "back to call", header button). */
export function showCallStage() {
  stageHidden = false;
}

/** Reset to idle and make sure no Room is left connected. */
export async function leaveGroupCall() {
  attempt++;
  const wasActive = activeKey !== null;
  activeKey = null;
  phase = 'idle';
  error = null;
  endReason = null;
  stopDisconnectListener?.();
  stopDisconnectListener = null;
  token = null;
  serverUrl = null;
  connected = false;
  title = '';
  href = null;
  code = null;
  stageHidden = false;
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
    case 'pass':
      return m.groups_call_error_pass();
    case 'removed':
      return m.groups_call_error_removed();
    default:
      return m.groups_call_error_generic();
  }
}
