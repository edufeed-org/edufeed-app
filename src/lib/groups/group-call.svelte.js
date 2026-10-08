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
import {
  requestGroupCallToken,
  moderateCall,
  GroupCallTokenError,
  isGuestParticipant
} from './livekit.js';
import { getChatBeside, setChatBeside } from '$lib/services/call-prefs.js';
import {
  confirmCallSwitch,
  confirmCallLeave,
  confirmCallJoin
} from './call-switch-confirm.svelte.js';
import { playLeaveSound } from '$lib/services/call-sounds.js';
import * as m from '$lib/paraglide/messages';
import { SignerTimeoutError, isLikelyMobile, signerTimeoutText } from '$lib/helpers/signer-wait.js';

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
// What the lobby chose to join with (camera / mic on). Kept for a retry of
// the same channel after a failed join, so the lobby is not asked twice.
/** @type {import('$lib/services/call-prefs.js').JoinMedia | null} */
let media = null;
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
// The connection service once a join has loaded it (see the header: never a
// static import). Lets the leave dialog read the seat synchronously.
/** @type {typeof import('$lib/services/livekit-connection.svelte.js') | null} */
let lkModule = null;

// The channel and the signer of the active call, for host actions
// (moderateActiveCall). Plain `let`: never rendered.
/** @type {{id: string, relay: string} | null} */
let activePointer = null;
/** @type {{pubkey: string, signer: any} | null} */
let activeUser = null;

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
 * @param {{title?: string, href?: string | null, code?: string, media?: import('$lib/services/call-prefs.js').JoinMedia}} [view]
 *   for the dock; `media`: publish camera / mic right away (the lobby's
 *   choice) — without it the call opens muted with the camera off
 */
export async function joinGroupCall(pointer, user, view = {}) {
  const key = channelKey(pointer);
  if (!key || !user?.signer) return;
  if (activeKey && activeKey !== key) await leaveGroupCall();
  stageHidden = false;
  if (activeKey === key && (phase === 'ready' || phase === 'requesting')) return;

  const myAttempt = ++attempt;
  activeKey = key;
  activePointer = { id: pointer.id, relay: pointer.relay };
  activeUser = user;
  phase = 'requesting';
  error = null;
  endReason = null;
  token = null;
  serverUrl = null;
  connected = false;
  title = view.title ?? '';
  href = view.href ?? null;
  code = view.code ?? null;
  media = view.media ?? null;
  try {
    const result = await requestGroupCallToken(pointer.relay, pointer.id, user, {
      code: view.code
    });
    if (myAttempt !== attempt) return;
    serverUrl = result.serverUrl;
    token = result.participantToken;
    phase = 'ready';
    const lk = await import('$lib/services/livekit-connection.svelte.js');
    lkModule = lk;
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
    await lk.connectToRoom(result.participantToken, result.serverUrl, view.media ?? {});
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
 * Join a call, confirming first when the user is still live in a call
 * (requesting/ready — i.e. not idle/ended/error) for a DIFFERENT channel.
 * Every member join entry point (the chat header, the meeting card and bar,
 * the channel roster's join pill) goes through this instead of calling
 * `joinGroupCall` directly, so the dialog only needs implementing once.
 * Same channel, or no live call elsewhere, joins straight away — and so
 * does a cancelled confirm, which leaves the current call untouched.
 *
 * Then the pre-join lobby (`confirmCallJoin`): camera and microphone are
 * checked and the "join with camera / mic on" choice made BEFORE any token
 * is requested — a member sitting in the lobby is not in the call yet.
 * Not asked when the channel is already live here (that only brings the
 * stage back) nor for a retry after a failed join of the same channel
 * (the earlier choice is reused); a cancelled lobby joins nothing.
 * @param {{id: string, relay: string}} pointer
 * @param {{pubkey: string, signer: any}} user
 * @param {{title?: string, href?: string | null, code?: string}} [view]
 * @returns {Promise<void>}
 */
export async function joinGroupCallWithConfirm(pointer, user, view = {}) {
  const key = channelKey(pointer);
  const switchingLiveCall =
    !!activeKey && key !== activeKey && (phase === 'requesting' || phase === 'ready');
  if (switchingLiveCall) {
    const proceed = await confirmCallSwitch(title);
    if (!proceed) return;
  }
  const alreadyLiveHere = activeKey === key && (phase === 'ready' || phase === 'requesting');
  if (alreadyLiveHere) {
    await joinGroupCall(pointer, user, view);
    return;
  }
  /** @type {import('$lib/services/call-prefs.js').JoinMedia | null} */
  let chosen = activeKey === key && phase === 'error' ? media : null;
  if (!chosen) {
    chosen = await confirmCallJoin(view.title ?? '');
    if (!chosen) return;
  }
  await joinGroupCall(pointer, user, { ...view, media: chosen });
}

/**
 * Move the live call to another channel WITHOUT the lobby — a breakout
 * switch (groups/breakout.svelte.js): the seat keeps its mic / camera state
 * (the background effect is re-read from prefs on connect anyway) and the
 * dock's way back stays the page the main call was shown on. No-op without
 * a live call; the signer is the one that joined.
 * @param {{id: string, relay: string}} pointer
 * @param {{title?: string}} [view]
 */
export async function switchGroupCall(pointer, view = {}) {
  if (!activeUser || !isLive()) return;
  const user = activeUser;
  const keepHref = href;
  const media = lkModule?.currentJoinMedia?.() ?? { audio: false, video: false };
  await joinGroupCall(pointer, user, { title: view.title ?? '', href: keepHref, media });
}

/** The channel of the active call (null while idle). */
export function getActiveCallPointer() {
  return activePointer ? { ...activePointer } : null;
}

/** The account that joined the active call (null while idle). */
export function getActiveCallUser() {
  return activeUser;
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
  activePointer = null;
  activeUser = null;
  token = null;
  serverUrl = null;
  connected = false;
  title = '';
  href = null;
  code = null;
  media = null;
  stageHidden = false;
  if (wasActive) {
    const { disconnectFromRoom } = await import('$lib/services/livekit-connection.svelte.js');
    await disconnectFromRoom();
  }
}

/**
 * The user's "Anruf verlassen": asks first while the call is live
 * (requesting/ready), then leaves with the leave cue. Every user-facing leave
 * button (stage, dock, guest page, pop-out) goes through this; a switch to
 * another call (already confirmed), the call ending on its own, a removal
 * and page unload use `leaveGroupCall` and never ask. An ended or failed
 * call just closes. If the call stops being live while the dialog is open
 * (it ended, the user was removed), the dialog is dismissed and nothing is
 * left: the store keeps showing why the call ended.
 * @param {(options: {guest: boolean, signal: AbortSignal}) => Promise<boolean>} [ask]
 *   where to ask — the pop-out window asks in its own document; `signal`
 *   aborts when the question has become moot
 * @returns {Promise<boolean>} whether the call was left
 */
export async function leaveGroupCallWithConfirm(ask = confirmCallLeave) {
  if (isLive()) {
    const moot = new AbortController();
    const myAttempt = attempt;
    const stopWatch = $effect.root(() => {
      $effect(() => {
        if (!isLive() || attempt !== myAttempt) moot.abort();
      });
    });
    let proceed = false;
    try {
      // A guest seat: that link is also the way back (the dialog says so).
      proceed = await ask({ guest: seatedAsGuest(), signal: moot.signal });
    } finally {
      stopWatch();
    }
    if (!proceed || moot.signal.aborted || !isLive() || attempt !== myAttempt) return false;
    playLeaveSound();
  }
  await leaveGroupCall();
  return true;
}

function isLive() {
  return phase === 'requesting' || phase === 'ready';
}

/**
 * Whether the seat we hold is a guest seat. The relay decides, not the link:
 * a member who opens a guest link gets a member token (the code is ignored
 * for members, docs/nips/nip29-call-passes.md), and only a guest token
 * carries `{"guest":true}` in the participant metadata. While the Room is
 * not up yet (token in flight) the code is the best available guess.
 * Synchronous on purpose: the dialog must open in the same tick as the
 * click, before anything else can end the call under it.
 */
function seatedAsGuest() {
  const local = connected ? lkModule?.getLiveKitState().localParticipant : null;
  if (local) return isGuestParticipant(local);
  return !!code;
}

/**
 * A host action on a seat of the active call (livekit.js `moderateCall`
 * against the channel the call belongs to, signed by the account that
 * joined it). Rejects with GroupCallModerationError — the relay's reason —
 * or when no call is live.
 * @param {{action: import('./livekit.js').CallModerationAction, identity: string}} request
 */
export async function moderateActiveCall(request) {
  if (!activePointer || !activeUser || !isLive()) {
    throw new Error('no active call');
  }
  await moderateCall(activePointer, activeUser, request);
}

/**
 * The user-facing line for a failed join.
 * @param {unknown} err
 * @returns {string}
 */
export function callErrorMessage(err) {
  if (err instanceof SignerTimeoutError) return signerTimeoutText(isLikelyMobile());
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
