/**
 * LiveKit Connection Service
 * Manages the LiveKit room connection and exposes reactive participant state.
 */
import { SvelteSet } from 'svelte/reactivity';
import { Room, RoomEvent, Track } from 'livekit-client';

/** @type {Room | null} */
let room = $state(null);

let isConnected = $state(false);
let isConnecting = $state(false);
let isMuted = $state(false);
let isCameraOff = $state(true);
let isScreenSharing = $state(false);

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
 * Connect to a LiveKit room.
 * @param {string} token - JWT token from operator
 * @param {string} url - LiveKit server WebSocket URL
 * @param {{ video?: boolean, audio?: boolean }} [opts]
 */
export async function connectToRoom(token, url, opts = {}) {
  if (isConnecting || isConnected) return;

  isConnecting = true;
  try {
    const newRoom = new Room();

    newRoom.on(RoomEvent.ParticipantConnected, updateParticipants);
    newRoom.on(RoomEvent.ParticipantDisconnected, updateParticipants);
    newRoom.on(RoomEvent.TrackSubscribed, updateParticipants);
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

    await newRoom.connect(url, token);

    // Publish local tracks
    await newRoom.localParticipant.setMicrophoneEnabled(opts.audio !== false);
    if (opts.video) {
      await newRoom.localParticipant.setCameraEnabled(true);
      isCameraOff = false;
    }
    isMuted = false;

    room = newRoom;
    isConnected = true;
    updateParticipants();

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
 * Disconnect from the current room.
 */
export async function disconnectFromRoom() {
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
 * Toggle local microphone.
 */
export async function toggleMute() {
  if (!room) return;
  const newState = !isMuted;
  await room.localParticipant.setMicrophoneEnabled(!newState);
  isMuted = newState;
}

/**
 * Toggle local camera.
 */
export async function toggleCamera() {
  if (!room) return;
  const newState = !isCameraOff;
  await room.localParticipant.setCameraEnabled(!newState);
  isCameraOff = newState;
}

/**
 * Toggle screen sharing.
 */
export async function toggleScreenShare() {
  if (!room) return;
  try {
    const newState = !isScreenSharing;
    await room.localParticipant.setScreenShareEnabled(newState);
    isScreenSharing = newState;
  } catch {
    // User cancelled browser screen picker
  }
}

/**
 * Get reactive connection state.
 * @returns {{ isConnected: boolean, isConnecting: boolean, isMuted: boolean, isCameraOff: boolean, isScreenSharing: boolean, localParticipant: import('livekit-client').LocalParticipant | null, remoteParticipants: import('livekit-client').RemoteParticipant[], room: Room | null, speakingParticipantIds: Set<string>, audioInputDevices: MediaDeviceInfo[], activeAudioDeviceId: string, audioOutputDevices: MediaDeviceInfo[], activeAudioOutputDeviceId: string, videoInputDevices: MediaDeviceInfo[], activeVideoDeviceId: string }}
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
