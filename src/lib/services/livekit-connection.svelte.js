/**
 * LiveKit Connection Service
 * Manages the LiveKit room connection and exposes reactive participant state.
 */
import { SvelteSet } from 'svelte/reactivity';
import { DisconnectReason, Room, RoomEvent, Track } from 'livekit-client';
import {
  SCREEN_SHARE_QUALITIES,
  cameraCaptureOptions,
  getBackgroundEffect,
  getParticipantVolume,
  getPreferredDevice,
  getScreenShareQuality,
  getScreenShareAudio,
  micCaptureOptions,
  rememberDevice,
  setAudioProcessing,
  setBackgroundEffect,
  setParticipantVolume as storeParticipantVolume
} from './call-prefs.js';
import {
  screenShareCaptureOptions,
  screenShareAudioMissing as screenShareAudioMissingIn
} from '$lib/groups/screen-share-options.js';
import {
  playJoinSound,
  playLeaveSound,
  playMuteSound,
  playScreenShareSound,
  playUnmuteSound
} from './call-sounds.js';
import { withHand, handQueue } from '$lib/groups/call-tile-order.js';
import { reactionPayload, parseReactionPayload } from '$lib/groups/call-reactions.js';
import { isGuestParticipant } from '$lib/groups/livekit.js';
import { safeCallFileType } from '$lib/groups/call-files.js';
import {
  noteCallChatMention,
  noteCallChatReceived,
  resetCallChatUnread
} from '$lib/groups/call-chat-unread.svelte.js';
import { isMentioned } from '$lib/groups/call-chat-mentions.js';
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';
import {
  CALL_CHAT_MAX_CHARS as CHAT_MAX_CHARS,
  newCallChatId,
  nonceFor,
  parseCallChatPayload,
  toCallChatPayload
} from '$lib/groups/call-chat-payload.js';
import { parseBackgroundEffect } from '$lib/groups/call-background.js';
import { applyBackgroundToTrack } from '$lib/groups/call-background-processor.js';

// A burst of joins (a class arriving) gets one cue, not twenty.
const JOIN_CUE_DEBOUNCE_MS = 750;
let lastRemoteJoinCue = 0;

/** @type {Room | null} */
let room = $state(null);

let isConnected = $state(false);
let isConnecting = $state(false);
let isMuted = $state(false);
let isCameraOff = $state(true);
let isScreenSharing = $state(false);
// The running share asked for sound ("Ton teilen") but the browser gave
// none: Firefox/Safari never do, Chrome only when the picker's "share
// audio" box was ticked. A hint for the UI, not an error.
let screenShareAudioMissing = $state(false);
// Whether the server lets the local participant publish tracks at all. A
// NIP-29 relay hands a non-member of a public group a listen-only token
// (canPublish=false); publishing would be refused, so the media setup and
// the toggles skip it and the UI hides the controls. True until a room says
// otherwise.
let canPublish = $state(true);

/** @type {import('livekit-client').RemoteParticipant[]} */
let remoteParticipants = $state.raw([]);

/** @type {import('livekit-client').LocalParticipant | null} */
let localParticipant = $state(null);
// Bumped whenever a participant's metadata changes (the relay pushes call
// roles through it, see groups/livekit.js participantCallRole): the
// participant objects themselves are not reactive, so a view that derives
// a role from `localParticipant.metadata` reads this to be re-run.
let participantMetadataVersion = $state(0);

/** @type {Set<string>} */
let speakingParticipantIds = $state.raw(new Set());

// --- Audio device state ---
/** @type {MediaDeviceInfo[]} */
let audioInputDevices = $state.raw([]);
let activeAudioDeviceId = $state('');

/** @type {MediaDeviceInfo[]} */
let audioOutputDevices = $state.raw([]);
let activeAudioOutputDeviceId = $state('');

// --- Video device state ---
/** @type {MediaDeviceInfo[]} */
let videoInputDevices = $state.raw([]);
let activeVideoDeviceId = $state('');
// Camera background effect, remembered per device (groups/call-background).
let backgroundEffect = $state(getBackgroundEffect());
// The BackgroundProcessor this service built last. Compared against the
// camera track's current processor: a new track (rejoin) has none, so a
// stale reference is simply replaced.
/** @type {any} */
let bgProcessor = null;
// Effect changes run one after another: building the MediaPipe pipeline
// takes a moment, and two overlapping setProcessor calls would race.
/** @type {Promise<unknown>} */
let backgroundQueue = Promise.resolve();

// --- Connection + participant state beyond the participant lists ---
/** @type {'connected' | 'reconnecting' | 'disconnected'} */
let connectionState = $state('disconnected');
// Why the last Room ended (livekit-client's DisconnectReason), null while
// connected or after our own disconnectFromRoom.
/** @type {import('livekit-client').DisconnectReason | null} */
let disconnectReason = $state(null);
// Our own disconnectFromRoom is running: its Disconnected event is expected
// and must not reach the listener below.
let disconnecting = false;
// One external listener (the call store) for disconnects the server or the
// network caused: a revoked call pass, a kick, a deleted room, a dead link.
/** @type {((reason: import('livekit-client').DisconnectReason | undefined) => void) | null} */
let disconnectListener = null;
/** Remote seats whose microphone is off. @type {Set<string>} */
let mutedIdentities = $state.raw(new Set());
/** Seats with a raised hand (local included), first raised first. @type {Set<string>} */
let raisedHands = $state.raw(new Set());
/**
 * Floating reactions, newest last; `url` = a NIP-30 custom emoji image.
 * @type {Array<{id: string, identity: string, emoji: string, url?: string}>}
 */
let reactions = $state.raw([]);
// Data messages need canPublishData; a listen-only token may lack it.
let canSignal = $state(true);
let handRaised = false;
/** When my hand went up (ms), re-sent to late joiners. */
let myHandAt = 0;
/** identity -> raise time (ms); `raisedHands` is this, in queue order. Internal. */
let handTimes = new Map();

// Remote audio is played HERE, one hidden element per subscribed track —
// not by the tiles. A call can be drawn several times at once (the /c
// layout's twins, the channel stage + the dock); tile-owned <audio> would
// play every voice once per drawing.
/** @type {Map<string, {track: any, el: HTMLMediaElement}>} */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
const audioSinks = new Map();

// Raise hand / reactions travel as LiveKit data messages on this topic:
// NIP-29 has no client presence plane (kind 39004 is relay-authored), and
// the SFU already connects exactly the people in the call.
const SIGNAL_TOPIC = 'edufeed.call';
// The quick picks. Any emoji (and NIP-30 custom ones) can be sent through the
// full picker — see groups/call-reactions.js for the wire format.
export const CALL_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '👏', '🙏', '🤔'];
const REACTION_TTL_MS = 4000;

// In-call chat: everyone in the call, guests included (who never see the
// channel chat). Ephemeral by design — nothing is stored anywhere.
// The wire format lives in groups/call-chat-payload.js.
const CHAT_TOPIC = 'edufeed.call.chat';
// Files in the call chat travel as LiveKit byte streams on this topic: through
// the SFU to the participants present right now, stored on no server, held
// here as object URLs only (issue "share files without storing them
// publicly"). Stream attributes carry the message `id` and, for a private
// file, `to`. Late joiners never get earlier files.
const FILE_TOPIC = 'edufeed.call.file';
export const CALL_FILE_MAX_BYTES = 25 * 1024 * 1024;
const FILE_CHUNK_BYTES = 64 * 1024;
const CHAT_KEEP = 200;
// Late joiners get each present participant's own recent messages (G).
const CHAT_REPLAY_MAX = 50;
// No call outlives a call pass (12 h): a replayed send time older than that
// is bogus and is clamped, like one from the future.
const CHAT_MAX_AGE_MS = 12 * 3600 * 1000;
// A sender's `ts` is honoured only as a history REPLAY, and replays arrive
// right after a join: within this window of the sender's arrival (or of our
// own join, for those already there). Later, `ts` is ignored and the
// message gets its receive time — a live message cannot backdate itself.
const CHAT_REPLAY_WINDOW_MS = 5000;
/** When this client joined the current Room (ms). */
let ownJoinAt = 0;
/** identity -> when that participant arrived after us (ms). Internal. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, never rendered
let arrivedAt = new Map();
/**
 * A kept call chat message. `id` is the sender's message id (what a reply
 * points at) or, for a peer that sends none, `<identity>:<n>`; it is the
 * unique local key either way. `guest`: the sender joined through a call
 * link — recorded at receipt, so it is still known after they left (the
 * chat export marks them). The optional fields mirror the payload's.
 * @typedef {{
 *   id: string, identity: string, n: string, text: string, at: number, guest?: boolean,
 *   emoji?: Array<[string, string]>,
 *   replyTo?: string, replyPreview?: { n: string, text: string },
 *   mentions?: string[], to?: string,
 *   file?: CallChatFile
 * }} CallChatMessage
 *
 * A file message (`text` is empty): the transfer's state on this side.
 * `url` is an object URL — memory only, revoked when the call ends.
 * @typedef {{
 *   name: string, size: number, mime: string,
 *   status: 'sending' | 'receiving' | 'done' | 'failed', progress: number, url?: string
 * }} CallChatFile
 */
/** @type {CallChatMessage[]} */
let callChat = $state.raw([]);

/**
 * Listen for disconnects NOT initiated by disconnectFromRoom(). One listener
 * at a time (the call store); returns the matching unsubscribe.
 * @param {(reason: import('livekit-client').DisconnectReason | undefined) => void} cb
 * @returns {() => void}
 */
export function onRoomDisconnected(cb) {
  disconnectListener = cb;
  return () => {
    if (disconnectListener === cb) disconnectListener = null;
  };
}

/**
 * Whether a disconnect reason means "taken out of the call" (removed by the
 * server, e.g. a revoked call pass, or the room deleted) rather than a lost
 * connection.
 * @param {unknown} reason
 */
export function isRemovalReason(reason) {
  return (
    reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED
  );
}

/**
 * Per-person key for volumes: NIP-29 identities are `<64-hex pubkey>:<suffix>`,
 * and one person may sit in the call twice.
 * @param {string | undefined} identity
 */
function volumeKey(identity) {
  const match = /^[0-9a-f]{64}/i.exec(identity ?? '');
  return match ? match[0].toLowerCase() : (identity ?? '');
}

function recomputeMuted() {
  /** @type {Set<string>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh, then assigned whole to a $state.raw
  const next = new Set();
  if (room) {
    for (const p of room.remoteParticipants.values()) {
      if (!p.isMicrophoneEnabled) next.add(p.identity);
    }
  }
  mutedIdentities = next;
}

/** @param {any} track @param {any} participant @param {string | undefined} source */
function attachRemoteAudio(track, participant, source) {
  if (track?.kind !== 'audio' || !track.sid || audioSinks.has(track.sid)) return;
  if (typeof document === 'undefined') return;
  const el = track.attach();
  el.hidden = true;
  el.autoplay = true;
  document.body.appendChild(el);
  audioSinks.set(track.sid, { track, el });
  // The person's volume applies to their voice and to the sound of their
  // shared screen alike.
  if (
    (source === Track.Source.Microphone || source === Track.Source.ScreenShareAudio) &&
    participant?.setVolume
  ) {
    participant.setVolume(getParticipantVolume(volumeKey(participant.identity)), source);
  }
}

/** @param {any} track */
function detachRemoteAudio(track) {
  const sink = track?.sid ? audioSinks.get(track.sid) : undefined;
  if (!sink) return;
  try {
    sink.track.detach(sink.el);
  } catch {
    // already gone
  }
  sink.el.remove();
  audioSinks.delete(track.sid);
}

function detachAllRemoteAudio() {
  for (const { track, el } of audioSinks.values()) {
    try {
      track.detach(el);
    } catch {
      // already gone
    }
    el.remove();
  }
  audioSinks.clear();
}

/**
 * Playback volume for one person (0..2, every seat of theirs), remembered
 * for later calls.
 * @param {string} pubkey
 * @param {number} volume
 */
export function setParticipantVolume(pubkey, volume) {
  const value = storeParticipantVolume(pubkey, volume);
  if (room) {
    for (const p of room.remoteParticipants.values()) {
      if (volumeKey(p.identity) === pubkey) {
        p.setVolume(value, Track.Source.Microphone);
        p.setVolume(value, Track.Source.ScreenShareAudio);
      }
    }
  }
  return value;
}

/** Whether a speaker can be picked: remote audio runs through Web Audio. */
export function canSelectSpeaker() {
  const Ctor =
    typeof globalThis !== 'undefined' ? /** @type {any} */ (globalThis).AudioContext : undefined;
  return typeof Ctor === 'function' && typeof Ctor.prototype?.setSinkId === 'function';
}

/**
 * Change noise suppression / echo cancellation / auto gain. They bind at
 * capture time, so a live mic is restarted with the new constraints.
 * @param {Partial<import('./call-prefs.js').AudioProcessing>} partial
 */
export async function setAudioProcessingLive(partial) {
  setAudioProcessing(partial);
  const pub = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = /** @type {any} */ (pub?.track);
  if (track?.restartTrack) await track.restartTrack(micCaptureOptions());
}

/** @param {Record<string, unknown>} payload @param {string[]} [destinationIdentities] */
async function publishSignal(payload, destinationIdentities) {
  if (!room || !canSignal) return;
  const data = new TextEncoder().encode(JSON.stringify(payload));
  try {
    await room.localParticipant.publishData(data, {
      reliable: true,
      topic: SIGNAL_TOPIC,
      ...(destinationIdentities ? { destinationIdentities } : {})
    });
  } catch (err) {
    console.warn('call signal not sent:', err);
  }
}

/**
 * @param {string} identity @param {string} emoji @param {string} nonce
 * @param {string} [url] custom emoji image
 */
function addReaction(identity, emoji, nonce, url) {
  const id = `${identity}:${nonce}`;
  if (reactions.some((r) => r.id === id)) return;
  reactions = [...reactions, url ? { id, identity, emoji, url } : { id, identity, emoji }];
  setTimeout(() => {
    reactions = reactions.filter((r) => r.id !== id);
  }, REACTION_TTL_MS);
}

/**
 * A hand went up or down. `raisedHands` keeps the queue order: first raised
 * first (the stage moves those seats to the front in that order).
 * @param {string} identity @param {boolean} raised @param {number} at
 */
function applyHand(identity, raised, at) {
  handTimes = withHand(handTimes, identity, raised, at);
  raisedHands = new Set(handQueue(handTimes));
}

function clearHands() {
  handRaised = false;
  myHandAt = 0;
  handTimes = new Map();
  raisedHands = new Set();
}

/**
 * The sender's own time for a message, honoured only as a REPLAY to a late
 * joiner — within CHAT_REPLAY_WINDOW_MS of the sender's arrival (or of our
 * own join, for those already there) — and clamped to [now - 12 h, now].
 * Otherwise undefined: a live message gets its receive time and can never
 * backdate itself.
 * @param {string} identity @param {unknown} ts
 * @returns {number | undefined}
 */
function replayedTime(identity, ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return undefined;
  const now = Date.now();
  const since = arrivedAt.get(identity) ?? ownJoinAt;
  if (now - since > CHAT_REPLAY_WINDOW_MS) return undefined;
  return Math.min(Math.max(ts, now - CHAT_MAX_AGE_MS), now);
}

/** @param {boolean} raised */
export async function setHandRaised(raised) {
  if (!room || !canSignal) return;
  handRaised = raised;
  myHandAt = raised ? Date.now() : 0;
  applyHand(room.localParticipant.identity, raised, myHandAt);
  await publishSignal(raised ? { t: 'hand', v: true, at: myHandAt } : { t: 'hand', v: false });
}

/**
 * @param {string | {shortcode: string, url: string}} emoji a unicode emoji,
 *   or a NIP-30 custom one (https image only)
 */
export async function sendReaction(emoji) {
  if (!room || !canSignal) return;
  const nonce = Math.random().toString(36).slice(2, 10);
  const payload = reactionPayload(emoji, nonce);
  if (!payload) return;
  addReaction(room.localParticipant.identity, payload.e, nonce, payload.custom?.url);
  await publishSignal(payload);
}

/**
 * Keep a chat message, deduped by id and by (identity, nonce), ordered by
 * send time. `ts` is the sender's clock (a replay to a late joiner);
 * without it the message counts as sent now; a `ts` is clamped to
 * [now - 12 h, now]. An id another sender already used falls back to the
 * legacy key so one key never names two rows.
 * @param {string} identity
 * @param {import('$lib/groups/call-chat-payload.js').CallChatParsed} parsed
 * @param {number | undefined} ts
 * @param {boolean} [guest]
 * @returns {CallChatMessage | null} the kept message, or null when it was a duplicate
 */
function addChat(identity, parsed, ts, guest = false) {
  const legacyId = `${identity}:${parsed.n}`;
  const byId = parsed.id ? callChat.find((c) => c.id === parsed.id) : undefined;
  if (byId?.identity === identity) return null;
  if (callChat.some((c) => c.identity === identity && c.n === parsed.n)) return null;
  const id = parsed.id && !byId ? parsed.id : legacyId;
  if (callChat.some((c) => c.id === id)) return null;
  const now = Date.now();
  const at =
    typeof ts === 'number' && Number.isFinite(ts)
      ? Math.min(Math.max(ts, now - CHAT_MAX_AGE_MS), now)
      : now;
  /** @type {CallChatMessage} */
  const msg = { id, identity, n: parsed.n, text: parsed.text, at };
  if (guest) msg.guest = true;
  if (parsed.emoji) msg.emoji = parsed.emoji;
  if (parsed.replyTo) msg.replyTo = parsed.replyTo;
  if (parsed.replyPreview) msg.replyPreview = parsed.replyPreview;
  if (parsed.mentions) msg.mentions = parsed.mentions;
  if (parsed.to) msg.to = parsed.to;
  callChat = [...callChat, msg].sort((a, b) => a.at - b.at).slice(-CHAT_KEEP);
  return msg;
}

/**
 * Hand a newcomer MY recent messages (never anyone else's: a receiver takes
 * the sender identity from LiveKit, so only the author can vouch for a
 * message). Oldest first, with the original send time.
 * @param {string} identity the newcomer
 */
async function replayOwnChat(identity) {
  if (!room || !canSignal || !identity) return;
  const local = room.localParticipant;
  // Never a private message (it was for one person, who may not be the
  // newcomer) and never a file (a byte stream is sent once, to those
  // present — a newcomer simply missed it, like today's screen share).
  const mine = callChat
    .filter((c) => c.identity === local.identity && !c.to && !c.file)
    .slice(-CHAT_REPLAY_MAX);
  for (const c of mine) {
    try {
      await local.publishData(
        new TextEncoder().encode(JSON.stringify(toCallChatPayload(c, { ts: true }))),
        { reliable: true, topic: CHAT_TOPIC, destinationIdentities: [identity] }
      );
    } catch (err) {
      console.warn('call chat history not sent:', err);
      return;
    }
  }
}

/**
 * Send a chat message to everyone in the call and keep the local copy.
 * @param {string} text
 * @param {{ emoji?: Array<[string, string]>, replyTo?: string,
 *   replyPreview?: { n: string, text: string }, mentions?: string[], to?: string }} [opts]
 *   the optional payload fields (see groups/call-chat-payload.js): `emoji`
 *   = the NIP-30 custom emojis the text references as [shortcode, url]
 *   pairs; `replyTo`/`replyPreview` = the message replied to; `mentions` =
 *   identities named in the text (`"*"` = everyone); `to` = the one
 *   identity a private message goes to (delivered to that participant
 *   only, never replayed)
 */
export async function sendCallChat(text, opts = {}) {
  const body = String(text ?? '')
    .trim()
    .slice(0, CHAT_MAX_CHARS);
  if (!room || !isConnected || !canSignal || !body) return;
  const id = newCallChatId();
  const parsed = parseCallChatPayload({ t: 'chat', id, n: nonceFor(id), text: body, ...opts });
  if (!parsed) return;
  const msg = addChat(
    room.localParticipant.identity,
    parsed,
    undefined,
    isGuestParticipant(room.localParticipant)
  );
  if (!msg) return;
  try {
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(toCallChatPayload(msg))),
      {
        reliable: true,
        topic: CHAT_TOPIC,
        ...(msg.to ? { destinationIdentities: [msg.to] } : {})
      }
    );
  } catch (err) {
    console.warn('call chat not sent:', err);
  }
}

/**
 * Patch a file message's transfer state in place (new array for reactivity).
 * @param {string} id @param {Partial<CallChatFile>} patch
 */
function patchFile(id, patch) {
  callChat = callChat.map((c) =>
    c.id === id && c.file ? { ...c, file: { ...c.file, ...patch } } : c
  );
}

/**
 * Keep a file message. @param {string} identity @param {string} id
 * @param {CallChatFile} file @param {string} [to] @param {boolean} [guest]
 */
function addFile(identity, id, file, to, guest = false) {
  if (callChat.some((c) => c.id === id)) return false;
  /** @type {CallChatMessage} */
  const msg = { id, identity, n: id.slice(0, 32), text: '', at: Date.now(), file };
  if (to) msg.to = to;
  if (guest) msg.guest = true;
  callChat = [...callChat, msg].sort((a, b) => a.at - b.at).slice(-CHAT_KEEP);
  return true;
}

/**
 * Send a file to everyone in the call (or to one person) as a byte stream.
 * Capped at CALL_FILE_MAX_BYTES on both ends.
 * @param {File} file
 * @param {{ to?: string }} [opts] `to`: deliver to this identity only
 * @returns {Promise<{ ok: true } | { ok: false, error: 'too-large' | 'failed' | 'not-connected' }>}
 */
export async function sendCallFile(file, opts = {}) {
  if (!room || !isConnected || !canSignal) return { ok: false, error: 'not-connected' };
  if (!file || file.size > CALL_FILE_MAX_BYTES) return { ok: false, error: 'too-large' };
  const local = room.localParticipant;
  const id = newCallChatId();
  const mime = file.type || 'application/octet-stream';
  addFile(
    local.identity,
    id,
    { name: file.name, size: file.size, mime, status: 'sending', progress: 0 },
    opts.to,
    isGuestParticipant(local)
  );
  try {
    const writer = await /** @type {any} */ (local).streamBytes({
      name: file.name,
      mimeType: mime,
      totalSize: file.size,
      topic: FILE_TOPIC,
      attributes: { id, ...(opts.to ? { to: opts.to } : {}) },
      ...(opts.to ? { destinationIdentities: [opts.to] } : {})
    });
    let sent = 0;
    for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
      const chunk = new Uint8Array(
        await file.slice(offset, offset + FILE_CHUNK_BYTES).arrayBuffer()
      );
      await writer.write(chunk);
      sent += chunk.byteLength;
      patchFile(id, { progress: sent / file.size });
    }
    await writer.close();
    patchFile(id, { status: 'done', progress: 1, url: URL.createObjectURL(file) });
    return { ok: true };
  } catch (err) {
    console.warn('call file not sent:', err);
    patchFile(id, { status: 'failed' });
    return { ok: false, error: 'failed' };
  }
}

/**
 * A byte stream on the file topic: keep it as a message while it arrives,
 * then as an object URL. Anything over the cap, or addressed to someone
 * else, is dropped unread.
 * @param {any} reader livekit-client ByteStreamReader
 * @param {{ identity: string }} from
 */
async function handleFileStream(reader, { identity }) {
  const info = reader?.info ?? {};
  const to = info.attributes?.to;
  if (to && to !== room?.localParticipant.identity) return;
  const size = typeof info.size === 'number' ? info.size : 0;
  if (size > CALL_FILE_MAX_BYTES) return;
  const declared = info.attributes?.id;
  const id =
    typeof declared === 'string' && /^[A-Za-z0-9_-]{8,36}$/.test(declared)
      ? declared
      : `${identity}:${info.id}`;
  // Untrusted: a blob typed text/html or image/svg+xml would run script in
  // the app's origin when opened. Raster images keep their type (inline
  // <img> preview), everything else is an opaque download (groups/call-files).
  const mime = safeCallFileType(info.mimeType);
  const sender = room?.remoteParticipants.get(identity);
  const added = addFile(
    identity,
    id,
    { name: String(info.name ?? 'file'), size, mime, status: 'receiving', progress: 0 },
    to,
    isGuestParticipant(sender)
  );
  if (!added) return;
  noteCallChatReceived();
  reader.onProgress = (/** @type {number | undefined} */ p) => {
    if (typeof p === 'number') patchFile(id, { progress: Math.min(Math.max(p, 0), 1) });
  };
  try {
    const chunks = await reader.readAll();
    const blob = new Blob(chunks, { type: mime });
    if (blob.size > CALL_FILE_MAX_BYTES) throw new Error('file larger than declared');
    patchFile(id, { status: 'done', progress: 1, size: blob.size, url: URL.createObjectURL(blob) });
  } catch (err) {
    console.warn('call file not received:', err);
    patchFile(id, { status: 'failed' });
  }
}

/** Object URLs are memory: drop them with the chat. */
function revokeFileUrls() {
  for (const c of callChat) {
    if (c.file?.url) {
      try {
        URL.revokeObjectURL(c.file.url);
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * @param {Uint8Array} payload
 * @param {{identity: string, metadata?: string} | undefined} participant
 * @param {unknown} _kind
 * @param {string | undefined} topic
 */
function handleSignal(payload, participant, _kind, topic) {
  if (!participant) return;
  if (topic === CHAT_TOPIC) {
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    const chat = parseCallChatPayload(raw);
    if (!chat) return;
    // A private message is for its addressee only — whatever the sender's
    // destinationIdentities said, a `to` that is not me is not mine.
    if (chat.to && chat.to !== room?.localParticipant.identity) return;
    const added = addChat(
      participant.identity,
      chat,
      replayedTime(participant.identity, chat.ts),
      isGuestParticipant(participant)
    );
    // Data from a remote participant: never my own message, so it can be
    // unread (the dots on the call chat tab, chat button and dock).
    if (added) {
      noteCallChatReceived();
      // Named me (or everyone): a stronger signal while no chat is on
      // screen — counted on the chat button / dock and a toast naming the
      // sender (LiveKit's participant name, else the identity's pubkey
      // prefix: the service has no profile lookup).
      if (isMentioned(added, room?.localParticipant.identity) && noteCallChatMention()) {
        const name =
          /** @type {{ name?: string }} */ (participant).name || participant.identity.slice(0, 8);
        showToast(m.groups_call_chat_mentioned_toast({ name }), 'info');
      }
    }
    return;
  }
  if (topic !== SIGNAL_TOPIC) return;
  /** @type {any} */
  let msg;
  try {
    msg = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return;
  }
  if (msg?.t === 'hand') {
    const raised = msg.v === true;
    applyHand(
      participant.identity,
      raised,
      raised ? (replayedTime(participant.identity, msg.at) ?? Date.now()) : 0
    );
  } else if (msg?.t === 'react') {
    const reaction = parseReactionPayload(msg);
    if (reaction) addReaction(participant.identity, reaction.emoji, reaction.nonce, reaction.url);
  }
}

/**
 * The host muted us through the relay (RoomService.MutePublishedTrack, see
 * groups/livekit.js moderateCall): LiveKit mutes the published track and
 * the client learns of it as TrackMuted on its own publication. Keep the
 * toggles truthful — a muted mic shows muted, a muted camera shows off —
 * and turn a muted screen share into a stopped one, since a paused share
 * is just a black tile for everyone else. Our own toggles end up here too
 * (setMicrophoneEnabled(false) also mutes), which is a no-op.
 * @param {Room} target
 * @param {{source?: string} | undefined} publication
 */
function followServerMute(target, publication) {
  if (target !== room) return;
  switch (publication?.source) {
    case Track.Source.Microphone:
      isMuted = true;
      break;
    case Track.Source.Camera:
      isCameraOff = true;
      break;
    case Track.Source.ScreenShare:
      if (isScreenSharing) {
        isScreenSharing = false;
        target.localParticipant.setScreenShareEnabled(false).catch(() => {});
      }
      break;
  }
}

function updateParticipants() {
  if (!room) {
    remoteParticipants = [];
    localParticipant = null;
    return;
  }
  localParticipant = room.localParticipant;
  remoteParticipants = Array.from(room.remoteParticipants.values());
}

/**
 * Refresh the list of available audio input and output devices.
 */
export async function refreshAudioDevices() {
  if (!room) return;
  try {
    const inputDevices = await Room.getLocalDevices('audioinput');
    audioInputDevices = inputDevices;

    // Detect active input — only on initial load (guard preserves user selections)
    if (!activeAudioDeviceId && inputDevices.length > 0) {
      const mapId = room.localParticipant.activeDeviceMap?.get('audioinput');
      activeAudioDeviceId =
        mapId && inputDevices.some((d) => d.deviceId === mapId) ? mapId : inputDevices[0].deviceId;
    }

    const outputDevices = await Room.getLocalDevices('audiooutput');
    audioOutputDevices = outputDevices;

    // Detect active output — only on initial load
    if (!activeAudioOutputDeviceId && outputDevices.length > 0) {
      const mapId = room.localParticipant.activeDeviceMap?.get('audiooutput');
      activeAudioOutputDeviceId =
        mapId && outputDevices.some((d) => d.deviceId === mapId)
          ? mapId
          : outputDevices[0].deviceId;
    }
  } catch (err) {
    console.error('Failed to enumerate audio devices:', err);
  }
}

/**
 * Switch the active audio input device.
 * @param {string} deviceId
 */
export async function switchAudioDevice(deviceId) {
  if (!room) return;
  try {
    await room.switchActiveDevice('audioinput', deviceId);
    activeAudioDeviceId = deviceId;
    rememberDevice('audioinput', deviceId);
  } catch (err) {
    console.error('Failed to switch audio device:', err);
  }
}

/**
 * Switch the active audio output (speaker) device.
 * @param {string} deviceId
 */
export async function switchAudioOutputDevice(deviceId) {
  if (!room) return;
  try {
    await room.switchActiveDevice('audiooutput', deviceId);
    activeAudioOutputDeviceId = deviceId;
    rememberDevice('audiooutput', deviceId);
  } catch (err) {
    console.error('Failed to switch audio output device:', err);
  }
}

/**
 * Refresh the list of available video input devices.
 */
export async function refreshVideoDevices() {
  if (!room) return;
  try {
    const devices = await Room.getLocalDevices('videoinput');
    videoInputDevices = devices;

    if (!activeVideoDeviceId && devices.length > 0) {
      const mapId = room.localParticipant.activeDeviceMap?.get('videoinput');
      activeVideoDeviceId =
        mapId && devices.some((d) => d.deviceId === mapId) ? mapId : devices[0].deviceId;
    }
  } catch (err) {
    console.error('Failed to enumerate video devices:', err);
  }
}

/**
 * Switch the active video input device.
 * @param {string} deviceId
 */
export async function switchVideoDevice(deviceId) {
  if (!room) return;
  try {
    await room.switchActiveDevice('videoinput', deviceId);
    activeVideoDeviceId = deviceId;
    rememberDevice('videoinput', deviceId);
  } catch (err) {
    console.error('Failed to switch video device:', err);
  }
}

/**
 * Put the remembered background effect on the local camera track, if the
 * camera is on. The processor package (and MediaPipe) is loaded on first
 * use only. Throws when the processor fails.
 */
function applyBackground() {
  const run = backgroundQueue.then(async () => {
    const track = /** @type {any} */ (
      room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track
    );
    if (!track) return;
    bgProcessor = await applyBackgroundToTrack(track, backgroundEffect, bgProcessor);
  });
  backgroundQueue = run.catch(() => {});
  return run;
}

/** Turning the camera on must not fail because of the effect. */
async function applyBackgroundSafely() {
  try {
    await applyBackground();
  } catch (err) {
    console.warn('Background effect not available:', err);
  }
}

/**
 * Choose the camera background effect ('none' | 'blur' | 'custom' |
 * 'preset:<id>'). Remembered on this device and applied right away when the
 * camera is on. A failing processor throws and the previous effect stays.
 * @param {string} effect
 */
export async function setCameraBackground(effect) {
  const previous = backgroundEffect;
  backgroundEffect = parseBackgroundEffect(effect);
  try {
    await applyBackground();
  } catch (err) {
    backgroundEffect = previous;
    await applyBackgroundSafely();
    throw err;
  }
  setBackgroundEffect(backgroundEffect);
}

/** Handle device change events */
function handleDeviceChange() {
  refreshAudioDevices();
  refreshVideoDevices();
}

/**
 * Connect to a LiveKit room. Joins MUTED with the camera off unless the
 * caller asks otherwise — nobody goes on air by surprise; the mic button is
 * the opt-in.
 * @param {string} token - JWT token from the relay's token endpoint
 * @param {string} url - LiveKit server WebSocket URL
 * @param {{ video?: boolean, audio?: boolean }} [opts] publish camera / mic right away
 */
export async function connectToRoom(token, url, opts = {}) {
  // Force clean up any stale state from a previous session
  if (isConnecting || isConnected || room) {
    isConnecting = false;
    await disconnectFromRoom();
  }

  isConnecting = true;
  disconnectReason = null;
  // Re-read: another tab (or the pre-join screen) may have changed it.
  backgroundEffect = getBackgroundEffect();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, never rendered
  arrivedAt = new Map();
  try {
    const newRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Remote audio through Web Audio gain nodes: per-person volume above
      // 100 % (setVolume) needs it; HTMLMediaElement.volume caps at 1.
      webAudioMix: true,
      audioCaptureDefaults: micCaptureOptions(),
      videoCaptureDefaults: cameraCaptureOptions(),
      publishDefaults: { dtx: true, red: true }
    });

    newRoom.on(RoomEvent.ParticipantConnected, (/** @type {any} */ participant) => {
      const now = Date.now();
      if (participant?.identity) arrivedAt.set(participant.identity, now);
      if (now - lastRemoteJoinCue > JOIN_CUE_DEBOUNCE_MS) {
        lastRemoteJoinCue = now;
        playJoinSound();
      }
      // A late joiner learns about a hand that is already up.
      if (handRaised && participant?.identity) {
        publishSignal({ t: 'hand', v: true, at: myHandAt }, [participant.identity]);
      }
      // ... and the chat so far, as far as it is mine to tell.
      if (participant?.identity) replayOwnChat(participant.identity);
      updateParticipants();
      recomputeMuted();
    });
    newRoom.on(RoomEvent.ParticipantDisconnected, (/** @type {any} */ participant) => {
      playLeaveSound();
      if (participant?.identity && raisedHands.has(participant.identity)) {
        applyHand(participant.identity, false, 0);
      }
      updateParticipants();
      recomputeMuted();
    });
    newRoom.on(
      RoomEvent.TrackSubscribed,
      (
        /** @type {any} */ track,
        /** @type {any} */ publication,
        /** @type {any} */ participant
      ) => {
        if (publication?.source === Track.Source.ScreenShare) playScreenShareSound();
        attachRemoteAudio(track, participant, publication?.source);
        updateParticipants();
        recomputeMuted();
      }
    );
    newRoom.on(RoomEvent.TrackUnsubscribed, (/** @type {any} */ track) => {
      detachRemoteAudio(track);
      updateParticipants();
      recomputeMuted();
    });
    newRoom.on(RoomEvent.TrackMuted, (publication, participant) => {
      recomputeMuted();
      if (participant === newRoom.localParticipant) followServerMute(newRoom, publication);
    });
    newRoom.on(RoomEvent.TrackUnmuted, recomputeMuted);
    newRoom.on(RoomEvent.ParticipantMetadataChanged, () => {
      participantMetadataVersion++;
      updateParticipants();
    });
    newRoom.on(RoomEvent.Reconnecting, () => (connectionState = 'reconnecting'));
    newRoom.on(RoomEvent.SignalReconnecting, () => (connectionState = 'reconnecting'));
    newRoom.on(RoomEvent.Reconnected, () => (connectionState = 'connected'));
    newRoom.on(RoomEvent.DataReceived, handleSignal);
    if (typeof newRoom.registerByteStreamHandler === 'function') {
      newRoom.registerByteStreamHandler(FILE_TOPIC, handleFileStream);
    }
    newRoom.on(RoomEvent.LocalTrackPublished, updateParticipants);
    newRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        isScreenSharing = false;
        screenShareAudioMissing = false;
      }
      updateParticipants();
    });
    newRoom.on(
      RoomEvent.ActiveSpeakersChanged,
      (/** @type {import('livekit-client').Participant[]} */ speakers) => {
        speakingParticipantIds = new SvelteSet(speakers.map((s) => s.identity));
      }
    );
    newRoom.on(
      RoomEvent.Disconnected,
      (/** @type {import('livekit-client').DisconnectReason | undefined} */ reason) => {
        // Only the live Room, and only when we did not ask for it.
        const unexpected = !disconnecting && room === newRoom;
        isConnected = false;
        connectionState = 'disconnected';
        disconnectReason = reason ?? null;
        if (unexpected) dropDeadRoom();
        updateParticipants();
        if (unexpected) disconnectListener?.(reason);
      }
    );
    newRoom.on(
      RoomEvent.ParticipantPermissionsChanged,
      (
        /** @type {any} */ _prev,
        /** @type {import('livekit-client').Participant} */ participant
      ) => {
        if (participant !== newRoom.localParticipant) return;
        canPublish = participant.permissions?.canPublish ?? true;
        canSignal = participant.permissions?.canPublishData ?? true;
      }
    );

    await newRoom.connect(url, token);
    ownJoinAt = Date.now();

    // Track room state immediately after connection — before media setup
    // so a camera/mic failure doesn't leave a zombie connection
    room = newRoom;
    isConnected = true;
    isMuted = true;
    isCameraOff = true;
    connectionState = 'connected';
    canPublish = newRoom.localParticipant.permissions?.canPublish ?? true;
    canSignal = newRoom.localParticipant.permissions?.canPublishData ?? true;
    updateParticipants();
    recomputeMuted();
    playJoinSound();

    const speaker = getPreferredDevice('audiooutput');
    if (speaker) {
      newRoom
        .switchActiveDevice('audiooutput', speaker)
        .then(() => (activeAudioOutputDeviceId = speaker))
        .catch(() => {});
    }

    // Publish only what was asked for (failures are non-fatal here — the
    // buttons stay available). A listen-only token publishes nothing.
    if (canPublish && opts.audio) {
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true, micCaptureOptions());
        isMuted = false;
      } catch (err) {
        console.warn('Microphone not available:', err);
      }
    }
    if (canPublish && opts.video) {
      try {
        await newRoom.localParticipant.setCameraEnabled(true, cameraCaptureOptions());
        isCameraOff = false;
      } catch (err) {
        console.warn('Camera not available:', err);
      }
      if (!isCameraOff) await applyBackgroundSafely();
    }

    // Initialize devices after connection
    await refreshAudioDevices();
    await refreshVideoDevices();

    // Listen for device changes
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }
  } catch (err) {
    console.error('LiveKit connection failed:', err);
    throw err;
  } finally {
    isConnecting = false;
  }
}

/**
 * The server or the network ended the Room: tear it down like
 * disconnectFromRoom does, so nothing is sent into it any more, but keep
 * the call chat readable on the end screen (cleared on leave / next join).
 */
function dropDeadRoom() {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }
  detachAllRemoteAudio();
  room = null;
  isConnected = false;
  connectionState = 'disconnected';
  isScreenSharing = false;
  screenShareAudioMissing = false;
  canPublish = false;
  canSignal = false;
  clearHands();
  mutedIdentities = new Set();
  reactions = [];
  speakingParticipantIds = new SvelteSet();
}

/**
 * Disconnect from the current room.
 */
export async function disconnectFromRoom() {
  // Remove device change listener
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }

  detachAllRemoteAudio();
  disconnecting = true;
  try {
    if (room) {
      await room.disconnect();
      room = null;
    }
  } finally {
    disconnecting = false;
  }
  disconnectReason = null;
  isConnected = false;
  connectionState = 'disconnected';
  isMuted = false;
  isCameraOff = true;
  isScreenSharing = false;
  screenShareAudioMissing = false;
  canPublish = true;
  canSignal = true;
  clearHands();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh, then assigned whole to a $state.raw
  mutedIdentities = new Set();
  reactions = [];
  revokeFileUrls();
  callChat = [];
  resetCallChatUnread();
  speakingParticipantIds = new SvelteSet();
  audioInputDevices = [];
  activeAudioDeviceId = '';
  audioOutputDevices = [];
  activeAudioOutputDeviceId = '';
  videoInputDevices = [];
  activeVideoDeviceId = '';
  updateParticipants();
}

/**
 * Toggle local microphone. Unmuting first resumes audio playback when the
 * browser suspended it (autoplay policy), then captures with the remembered
 * device and processing flags. A failure (permission denied, no device)
 * throws so the UI can say why, and the call stays muted.
 */
export async function toggleMute() {
  if (!room || !canPublish) return;
  if (isMuted) {
    if (!room.canPlaybackAudio) await room.startAudio().catch(() => {});
    await room.localParticipant.setMicrophoneEnabled(true, micCaptureOptions());
    isMuted = false;
    playUnmuteSound();
  } else {
    await room.localParticipant.setMicrophoneEnabled(false);
    isMuted = true;
    playMuteSound();
  }
}

/**
 * Toggle local camera. A failure throws and the camera stays off.
 */
export async function toggleCamera() {
  if (!room || !canPublish) return;
  if (isCameraOff) {
    await room.localParticipant.setCameraEnabled(true, cameraCaptureOptions());
    isCameraOff = false;
    await applyBackgroundSafely();
  } else {
    await room.localParticipant.setCameraEnabled(false);
    isCameraOff = true;
  }
}

/**
 * Whether a screen-capture error is the user closing the browser picker —
 * Chromium and Firefox report that as a plain NotAllowedError; an OS-level
 * denial says so ("…denied by system").
 * @param {unknown} err
 */
function isPickerCancel(err) {
  const e = /** @type {{name?: string, message?: string}} */ (err ?? {});
  return e.name === 'NotAllowedError' && !/system/i.test(e.message ?? '');
}

/**
 * Toggle screen sharing. Closing the picker is not an error; anything else
 * (OS denial, capture failure) throws for the UI to explain.
 */
export async function toggleScreenShare() {
  if (!room || !canPublish) return;
  const newState = !isScreenSharing;
  try {
    if (newState) {
      // Sound only on request ("Ton teilen"), and then with our own tab kept
      // out of the picker — capturing the tab that plays the call would
      // echo the call back into itself (groups/screen-share-options.js).
      const audio = getScreenShareAudio();
      await room.localParticipant.setScreenShareEnabled(
        true,
        screenShareCaptureOptions({
          resolution: SCREEN_SHARE_QUALITIES[getScreenShareQuality()],
          audio
        })
      );
      screenShareAudioMissing = screenShareAudioMissingIn(
        audio,
        room.localParticipant.trackPublications?.values?.() ?? [],
        Track.Source.ScreenShareAudio
      );
    } else {
      await room.localParticipant.setScreenShareEnabled(false);
      screenShareAudioMissing = false;
    }
    isScreenSharing = newState;
    if (newState) playScreenShareSound();
  } catch (err) {
    if (newState && isPickerCancel(err)) return;
    throw err;
  }
}

/**
 * Get reactive connection state.
 * @returns {{ isConnected: boolean, isConnecting: boolean, isMuted: boolean, isCameraOff: boolean, isScreenSharing: boolean, screenShareAudioMissing: boolean, canPublish: boolean, canSignal: boolean, connectionState: 'connected' | 'reconnecting' | 'disconnected', disconnectReason: import('livekit-client').DisconnectReason | null, mutedIdentities: Set<string>, raisedHands: Set<string>, reactions: Array<{id: string, identity: string, emoji: string, url?: string}>, callChat: CallChatMessage[], localParticipant: import('livekit-client').LocalParticipant | null, remoteParticipants: import('livekit-client').RemoteParticipant[], participantMetadataVersion: number, room: Room | null, speakingParticipantIds: Set<string>, audioInputDevices: MediaDeviceInfo[], activeAudioDeviceId: string, audioOutputDevices: MediaDeviceInfo[], activeAudioOutputDeviceId: string, videoInputDevices: MediaDeviceInfo[], activeVideoDeviceId: string, backgroundEffect: string }}
 */
export function getLiveKitState() {
  return {
    get isConnected() {
      return isConnected;
    },
    get isConnecting() {
      return isConnecting;
    },
    get isMuted() {
      return isMuted;
    },
    get isCameraOff() {
      return isCameraOff;
    },
    get isScreenSharing() {
      return isScreenSharing;
    },
    get screenShareAudioMissing() {
      return screenShareAudioMissing;
    },
    get canPublish() {
      return canPublish;
    },
    get canSignal() {
      return canSignal;
    },
    get connectionState() {
      return connectionState;
    },
    get disconnectReason() {
      return disconnectReason;
    },
    get mutedIdentities() {
      return mutedIdentities;
    },
    get raisedHands() {
      return raisedHands;
    },
    get reactions() {
      return reactions;
    },
    get callChat() {
      return callChat;
    },
    get localParticipant() {
      return localParticipant;
    },
    get remoteParticipants() {
      return remoteParticipants;
    },
    get participantMetadataVersion() {
      return participantMetadataVersion;
    },
    get room() {
      return room;
    },
    get speakingParticipantIds() {
      return speakingParticipantIds;
    },
    get audioInputDevices() {
      return audioInputDevices;
    },
    get activeAudioDeviceId() {
      return activeAudioDeviceId;
    },
    get audioOutputDevices() {
      return audioOutputDevices;
    },
    get activeAudioOutputDeviceId() {
      return activeAudioOutputDeviceId;
    },
    get videoInputDevices() {
      return videoInputDevices;
    },
    get activeVideoDeviceId() {
      return activeVideoDeviceId;
    },
    get backgroundEffect() {
      return backgroundEffect;
    }
  };
}
