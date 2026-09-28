/**
 * LiveKit Connection Service
 * Manages the LiveKit room connection and exposes reactive participant state.
 */
import { SvelteSet } from 'svelte/reactivity';
import { Room, RoomEvent, Track } from 'livekit-client';
import {
  cameraCaptureOptions,
  getPreferredDevice,
  micCaptureOptions,
  rememberDevice
} from './call-prefs.js';
import {
  playJoinSound,
  playLeaveSound,
  playMuteSound,
  playScreenShareSound,
  playUnmuteSound
} from './call-sounds.js';

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

    newRoom.on(RoomEvent.ParticipantConnected, () => {
      const now = Date.now();
      if (now - lastRemoteJoinCue > JOIN_CUE_DEBOUNCE_MS) {
        lastRemoteJoinCue = now;
        playJoinSound();
      }
      updateParticipants();
    });
    newRoom.on(RoomEvent.ParticipantDisconnected, () => {
      playLeaveSound();
      updateParticipants();
    });
    newRoom.on(
      RoomEvent.TrackSubscribed,
      (/** @type {any} */ _track, /** @type {any} */ publication) => {
        if (publication?.source === Track.Source.ScreenShare) playScreenShareSound();
        updateParticipants();
      }
    );
    newRoom.on(RoomEvent.TrackUnsubscribed, updateParticipants);
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
    newRoom.on(RoomEvent.Disconnected, () => {
      isConnected = false;
      updateParticipants();
    });
    newRoom.on(
      RoomEvent.ParticipantPermissionsChanged,
      (
        /** @type {any} */ _prev,
        /** @type {import('livekit-client').Participant} */ participant
      ) => {
        if (participant !== newRoom.localParticipant) return;
        canPublish = participant.permissions?.canPublish ?? true;
      }
    );

    await newRoom.connect(url, token);

    // Track room state immediately after connection — before media setup
    // so a camera/mic failure doesn't leave a zombie connection
    room = newRoom;
    isConnected = true;
    isMuted = true;
    isCameraOff = true;
    canPublish = newRoom.localParticipant.permissions?.canPublish ?? true;
    updateParticipants();
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

// --- Shared ownership of the one Room -------------------------------------
// A call stage can have twins: under /c/* the community layout renders its
// page 2-3× (responsive variants, CSS hides the inactive ones), and at the
// lg breakpoint the visible twin swaps. Each twin acquires the call with the
// token it was handed; the same token reuses the Room (in flight or live)
// instead of opening a second session with the same identity — which the
// server answers by kicking the first ("could not establish pc connection",
// live 2026-09-28). Only the last owner's release disconnects. Plain lets:
// bookkeeping, not UI state.
/** @type {string | null} */
let ownedToken = null;
/** @type {Promise<void> | null} */
let ownedConnect = null;
let owners = 0;

/**
 * Join (or share) the call for this token.
 * @param {string} token
 * @param {string} url
 * @param {{ video?: boolean, audio?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function acquireRoom(token, url, opts = {}) {
  if (ownedToken === token && ownedConnect) {
    owners++;
    return ownedConnect;
  }
  // connectToRoom's synchronous part may disconnect a previous call, which
  // resets ownership — so claim it only after the call returns.
  const attempt = connectToRoom(token, url, opts);
  ownedToken = token;
  ownedConnect = attempt;
  owners = 1;
  attempt.catch(() => {
    if (ownedConnect !== attempt) return;
    ownedToken = null;
    ownedConnect = null;
    owners = 0;
  });
  return attempt;
}

/**
 * Give up one claim on the call; the last owner disconnects. A release for
 * a token that is no longer the current call is a no-op, so a late cleanup
 * can never end a newer call.
 * @param {string} token
 */
export async function releaseRoom(token) {
  if (token !== ownedToken || owners === 0) return;
  owners--;
  if (owners > 0) return;
  await disconnectFromRoom();
}

/**
 * Disconnect from the current room.
 */
export async function disconnectFromRoom() {
  ownedToken = null;
  ownedConnect = null;
  owners = 0;
  // Remove device change listener
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }

  if (room) {
    await room.disconnect();
    room = null;
  }
  isConnected = false;
  isMuted = false;
  isCameraOff = true;
  isScreenSharing = false;
  canPublish = true;
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
    await room.localParticipant.setScreenShareEnabled(newState);
    isScreenSharing = newState;
    if (newState) playScreenShareSound();
  } catch (err) {
    if (newState && isPickerCancel(err)) return;
    throw err;
  }
}

/**
 * Get reactive connection state.
 * @returns {{ isConnected: boolean, isConnecting: boolean, isMuted: boolean, isCameraOff: boolean, isScreenSharing: boolean, canPublish: boolean, localParticipant: import('livekit-client').LocalParticipant | null, remoteParticipants: import('livekit-client').RemoteParticipant[], room: Room | null, speakingParticipantIds: Set<string>, audioInputDevices: MediaDeviceInfo[], activeAudioDeviceId: string, audioOutputDevices: MediaDeviceInfo[], activeAudioOutputDeviceId: string, videoInputDevices: MediaDeviceInfo[], activeVideoDeviceId: string }}
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
