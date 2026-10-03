/**
 * LiveKit Connection Service
 * Manages the LiveKit room connection and exposes reactive participant state.
 */
import { SvelteSet } from 'svelte/reactivity';
import { DisconnectReason, Room, RoomEvent, Track } from 'livekit-client';
import {
  SCREEN_SHARE_QUALITIES,
  cameraCaptureOptions,
  getParticipantVolume,
  getPreferredDevice,
  getScreenShareQuality,
  micCaptureOptions,
  rememberDevice,
  setAudioProcessing,
  setParticipantVolume as storeParticipantVolume
} from './call-prefs.js';
import {
  playJoinSound,
  playLeaveSound,
  playMuteSound,
  playScreenShareSound,
  playUnmuteSound
} from './call-sounds.js';
import { withHand, handQueue } from '$lib/groups/call-tile-order.js';
import { reactionPayload, parseReactionPayload } from '$lib/groups/call-reactions.js';

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
const CHAT_TOPIC = 'edufeed.call.chat';
const CHAT_MAX_CHARS = 2000;
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
/** @type {Array<{id: string, identity: string, n: string, text: string, at: number}>} */
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
  if (source === Track.Source.Microphone && participant?.setVolume) {
    participant.setVolume(
      getParticipantVolume(volumeKey(participant.identity)),
      Track.Source.Microphone
    );
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
      if (volumeKey(p.identity) === pubkey) p.setVolume(value, Track.Source.Microphone);
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
 * Keep a chat message, deduped by (identity, nonce) and ordered by send time.
 * `ts` is the sender's clock (a replay to a late joiner); without it the
 * message counts as sent now; a `ts` is clamped to [now - 12 h, now].
 * @param {string} identity @param {string} text @param {string} nonce @param {number} [ts]
 */
function addChat(identity, text, nonce, ts) {
  const id = `${identity}:${nonce}`;
  if (callChat.some((c) => c.id === id)) return;
  const now = Date.now();
  const at =
    typeof ts === 'number' && Number.isFinite(ts)
      ? Math.min(Math.max(ts, now - CHAT_MAX_AGE_MS), now)
      : now;
  callChat = [...callChat, { id, identity, n: nonce, text, at }]
    .sort((a, b) => a.at - b.at)
    .slice(-CHAT_KEEP);
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
  const mine = callChat.filter((c) => c.identity === local.identity).slice(-CHAT_REPLAY_MAX);
  for (const c of mine) {
    try {
      await local.publishData(
        new TextEncoder().encode(JSON.stringify({ t: 'chat', text: c.text, n: c.n, ts: c.at })),
        { reliable: true, topic: CHAT_TOPIC, destinationIdentities: [identity] }
      );
    } catch (err) {
      console.warn('call chat history not sent:', err);
      return;
    }
  }
}

/** @param {string} text */
export async function sendCallChat(text) {
  const body = String(text ?? '')
    .trim()
    .slice(0, CHAT_MAX_CHARS);
  if (!room || !isConnected || !canSignal || !body) return;
  const nonce = Math.random().toString(36).slice(2, 12);
  addChat(room.localParticipant.identity, body, nonce);
  try {
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ t: 'chat', text: body, n: nonce })),
      { reliable: true, topic: CHAT_TOPIC }
    );
  } catch (err) {
    console.warn('call chat not sent:', err);
  }
}

/**
 * @param {Uint8Array} payload
 * @param {{identity: string} | undefined} participant
 * @param {unknown} _kind
 * @param {string | undefined} topic
 */
function handleSignal(payload, participant, _kind, topic) {
  if (!participant) return;
  if (topic === CHAT_TOPIC) {
    /** @type {any} */
    let chat;
    try {
      chat = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    if (
      chat?.t === 'chat' &&
      typeof chat.text === 'string' &&
      chat.text.trim() &&
      chat.text.length <= CHAT_MAX_CHARS &&
      typeof chat.n === 'string' &&
      chat.n.length > 0 &&
      chat.n.length <= 32
    ) {
      addChat(
        participant.identity,
        chat.text.trim(),
        chat.n,
        replayedTime(participant.identity, chat.ts)
      );
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
    newRoom.on(RoomEvent.TrackMuted, recomputeMuted);
    newRoom.on(RoomEvent.TrackUnmuted, recomputeMuted);
    newRoom.on(RoomEvent.Reconnecting, () => (connectionState = 'reconnecting'));
    newRoom.on(RoomEvent.SignalReconnecting, () => (connectionState = 'reconnecting'));
    newRoom.on(RoomEvent.Reconnected, () => (connectionState = 'connected'));
    newRoom.on(RoomEvent.DataReceived, handleSignal);
    newRoom.on(RoomEvent.LocalTrackPublished, updateParticipants);
    newRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.source === Track.Source.ScreenShare) {
        isScreenSharing = false;
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
  canPublish = true;
  canSignal = true;
  clearHands();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built fresh, then assigned whole to a $state.raw
  mutedIdentities = new Set();
  reactions = [];
  callChat = [];
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
      // No system audio: capturing it without the browser's own-audio
      // restriction echoes the call back into itself.
      await room.localParticipant.setScreenShareEnabled(true, {
        audio: false,
        resolution: SCREEN_SHARE_QUALITIES[getScreenShareQuality()],
        contentHint: 'detail'
      });
    } else {
      await room.localParticipant.setScreenShareEnabled(false);
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
 * @returns {{ isConnected: boolean, isConnecting: boolean, isMuted: boolean, isCameraOff: boolean, isScreenSharing: boolean, canPublish: boolean, canSignal: boolean, connectionState: 'connected' | 'reconnecting' | 'disconnected', disconnectReason: import('livekit-client').DisconnectReason | null, mutedIdentities: Set<string>, raisedHands: Set<string>, reactions: Array<{id: string, identity: string, emoji: string, url?: string}>, callChat: Array<{id: string, identity: string, n: string, text: string, at: number}>, localParticipant: import('livekit-client').LocalParticipant | null, remoteParticipants: import('livekit-client').RemoteParticipant[], room: Room | null, speakingParticipantIds: Set<string>, audioInputDevices: MediaDeviceInfo[], activeAudioDeviceId: string, audioOutputDevices: MediaDeviceInfo[], activeAudioOutputDeviceId: string, videoInputDevices: MediaDeviceInfo[], activeVideoDeviceId: string }}
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
    }
  };
}
