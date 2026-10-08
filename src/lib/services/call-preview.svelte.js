// Pre-join preview ("Bereit für den Anruf?"): the local camera and
// microphone as plain local tracks, never a Room. Nothing is sent anywhere
// and no token exists yet, so a visitor sitting on the preview is not in the
// call (no kind 39004 seat) until they press join.
//
// Owns the one preview app-wide: the lobby shows in one place at a time
// (the guest landing page, or the member pre-join modal). Devices picked
// here are remembered through call-prefs — the same keys the live call's
// capture options read — so the call then opens with exactly what the user
// checked. Loaded lazily with the lobby component: this module imports
// livekit-client (~300KB) and must never enter a route's static graph.
import {
  Room,
  createLocalAudioTrack,
  createLocalVideoTrack,
  createAudioAnalyser
} from 'livekit-client';
import {
  cameraCaptureOptions,
  getBackgroundEffect,
  getPreferredDevice,
  micCaptureOptions,
  rememberDevice,
  setBackgroundEffect
} from './call-prefs.js';
import { parseBackgroundEffect } from '$lib/groups/call-background.js';
import { applyBackgroundToTrack } from '$lib/groups/call-background-processor.js';

/** @type {import('livekit-client').LocalVideoTrack | null} */
let videoTrack = $state(null);
/** @type {import('livekit-client').LocalAudioTrack | null} */
let audioTrack = $state(null);
// Microphone level 0..1 (createAudioAnalyser's calculateVolume), ~60 fps.
let level = $state(0);
// Why the camera / microphone could not start (the raw error; the UI maps it
// through callMediaErrorMessage). Cleared on the next attempt.
/** @type {unknown} */
let cameraError = $state(null);
/** @type {unknown} */
let micError = $state(null);
// Only while a capture is being opened: the toggles disable, nothing races.
let cameraStarting = $state(false);
let micStarting = $state(false);

/** @type {MediaDeviceInfo[]} */
let audioInputDevices = $state.raw([]);
/** @type {MediaDeviceInfo[]} */
let audioOutputDevices = $state.raw([]);
/** @type {MediaDeviceInfo[]} */
let videoInputDevices = $state.raw([]);
let activeAudioDeviceId = $state('');
let activeAudioOutputDeviceId = $state('');
let activeVideoDeviceId = $state('');

// Camera background effect: the same per-device key the live call reads on
// connect (call-prefs 'background'), shown on the preview track through the
// same processor (groups/call-background-processor).
let backgroundEffect = $state(getBackgroundEffect());
// Why the last effect could not start (raw error; the UI says "not
// available in this browser"). Cleared on the next pick and on stop.
/** @type {unknown} */
let backgroundError = $state(null);
// The processor this module built last; livekit's track.stop() destroys
// it, so a released camera leaves no processor behind — only this reference,
// reset in releaseVideo so the next camera builds a fresh one.
/** @type {any} */
let bgProcessor = null;
// Effect changes run one after another (building MediaPipe takes a moment).
/** @type {Promise<unknown>} */
let backgroundQueue = Promise.resolve();

/** @type {ReturnType<typeof createAudioAnalyser> | null} */
let analyser = null;
let meterFrame = 0;
// Bumped per start/stop so a capture that resolves after the user already
// switched the toggle off (or left the lobby) is released, not kept.
let cameraSeq = 0;
let micSeq = 0;

/**
 * @returns {{
 *   videoTrack: import('livekit-client').LocalVideoTrack | null,
 *   audioTrack: import('livekit-client').LocalAudioTrack | null,
 *   level: number,
 *   cameraError: unknown,
 *   micError: unknown,
 *   cameraStarting: boolean,
 *   micStarting: boolean,
 *   audioInputDevices: MediaDeviceInfo[],
 *   audioOutputDevices: MediaDeviceInfo[],
 *   videoInputDevices: MediaDeviceInfo[],
 *   activeAudioDeviceId: string,
 *   activeAudioOutputDeviceId: string,
 *   activeVideoDeviceId: string,
 *   backgroundEffect: string,
 *   backgroundError: unknown
 * }}
 */
export function getCallPreviewState() {
  return {
    get backgroundEffect() {
      return backgroundEffect;
    },
    get backgroundError() {
      return backgroundError;
    },
    get videoTrack() {
      return videoTrack;
    },
    get audioTrack() {
      return audioTrack;
    },
    get level() {
      return level;
    },
    get cameraError() {
      return cameraError;
    },
    get micError() {
      return micError;
    },
    get cameraStarting() {
      return cameraStarting;
    },
    get micStarting() {
      return micStarting;
    },
    get audioInputDevices() {
      return audioInputDevices;
    },
    get audioOutputDevices() {
      return audioOutputDevices;
    },
    get videoInputDevices() {
      return videoInputDevices;
    },
    get activeAudioDeviceId() {
      return activeAudioDeviceId;
    },
    get activeAudioOutputDeviceId() {
      return activeAudioOutputDeviceId;
    },
    get activeVideoDeviceId() {
      return activeVideoDeviceId;
    }
  };
}

/**
 * Open or release the preview camera. Idempotent; a failure lands in
 * `cameraError` and leaves the camera off.
 * @param {boolean} on
 */
export async function setPreviewCamera(on) {
  const seq = ++cameraSeq;
  if (!on) {
    releaseVideo();
    return;
  }
  if (videoTrack || cameraStarting) return;
  cameraError = null;
  cameraStarting = true;
  try {
    const track = await createLocalVideoTrack(cameraCaptureOptions());
    if (seq !== cameraSeq) {
      track.stop();
      return;
    }
    videoTrack = track;
    activeVideoDeviceId = (await track.getDeviceId()) || activeVideoDeviceId;
    // The remembered effect goes on the preview as soon as there is a
    // track; a failing effect never keeps the camera from showing.
    await applyPreviewBackgroundSafely();
    await refreshPreviewDevices();
  } catch (err) {
    if (seq === cameraSeq) cameraError = err;
  } finally {
    if (seq === cameraSeq) cameraStarting = false;
  }
}

/**
 * Read the effect remembered on this device (the in-call menu or another
 * tab may have changed it since this module loaded). The lobby calls it on
 * mount so its control starts on the truth.
 */
export function syncPreviewBackground() {
  backgroundEffect = getBackgroundEffect();
  backgroundError = null;
}

/**
 * Choose the camera background effect ('none' | 'blur' | 'custom' |
 * 'preset:<id>') for the preview AND the call that follows: remembered on
 * this device (the call reads the same key on connect) and shown on the
 * preview track right away when the camera is on. A failing processor
 * keeps the previous effect and lands in `backgroundError`.
 * @param {string} effect
 */
export async function setPreviewBackground(effect) {
  const previous = backgroundEffect;
  backgroundEffect = parseBackgroundEffect(effect);
  backgroundError = null;
  try {
    await applyPreviewBackground();
  } catch (err) {
    backgroundEffect = previous;
    backgroundError = err;
    await applyPreviewBackgroundSafely();
    return;
  }
  setBackgroundEffect(backgroundEffect);
}

/** Put `backgroundEffect` on the preview track, if any. Throws on failure. */
function applyPreviewBackground() {
  const run = backgroundQueue.then(async () => {
    const track = videoTrack;
    if (!track) return;
    bgProcessor = await applyBackgroundToTrack(track, backgroundEffect, bgProcessor);
  });
  backgroundQueue = run.catch(() => {});
  return run;
}

async function applyPreviewBackgroundSafely() {
  try {
    await applyPreviewBackground();
  } catch (err) {
    console.warn('Background effect not available:', err);
  }
}

/**
 * Open or release the preview microphone (with the level meter). Idempotent;
 * a failure lands in `micError` and leaves the microphone off.
 * @param {boolean} on
 */
export async function setPreviewMic(on) {
  const seq = ++micSeq;
  if (!on) {
    releaseAudio();
    return;
  }
  if (audioTrack || micStarting) return;
  micError = null;
  micStarting = true;
  try {
    const track = await createLocalAudioTrack(micCaptureOptions());
    if (seq !== micSeq) {
      track.stop();
      return;
    }
    audioTrack = track;
    activeAudioDeviceId = (await track.getDeviceId()) || activeAudioDeviceId;
    startMeter(track);
    await refreshPreviewDevices();
  } catch (err) {
    if (seq === micSeq) micError = err;
  } finally {
    if (seq === micSeq) micStarting = false;
  }
}

/**
 * Pick a device for the preview AND the call that follows (remembered in
 * call-prefs, which the live capture options read). A running preview
 * track is restarted on the new device; the speaker only needs remembering
 * — nothing plays here, the call applies it on connect.
 * @param {MediaDeviceKind} kind
 * @param {string} deviceId
 */
export async function switchPreviewDevice(kind, deviceId) {
  rememberDevice(kind, deviceId);
  if (kind === 'audiooutput') {
    activeAudioOutputDeviceId = deviceId;
    return;
  }
  if (kind === 'videoinput') {
    activeVideoDeviceId = deviceId;
    if (videoTrack) {
      try {
        await videoTrack.restartTrack(cameraCaptureOptions());
      } catch (err) {
        cameraError = err;
      }
    }
    return;
  }
  activeAudioDeviceId = deviceId;
  if (audioTrack) {
    try {
      await audioTrack.restartTrack(micCaptureOptions());
      // The analyser is bound to the old MediaStreamTrack.
      startMeter(audioTrack);
    } catch (err) {
      micError = err;
    }
  }
}

/**
 * Enumerate devices without prompting (labels fill in once a capture has
 * been granted — the toggles do that). Active ids default to the
 * remembered device when it is present, else the first one.
 */
export async function refreshPreviewDevices() {
  try {
    const [mics, speakers, cams] = await Promise.all([
      Room.getLocalDevices('audioinput', false),
      Room.getLocalDevices('audiooutput', false),
      Room.getLocalDevices('videoinput', false)
    ]);
    audioInputDevices = mics;
    audioOutputDevices = speakers;
    videoInputDevices = cams;
    if (!activeAudioDeviceId) activeAudioDeviceId = pick(mics, getPreferredDevice('audioinput'));
    if (!activeAudioOutputDeviceId)
      activeAudioOutputDeviceId = pick(speakers, getPreferredDevice('audiooutput'));
    if (!activeVideoDeviceId) activeVideoDeviceId = pick(cams, getPreferredDevice('videoinput'));
  } catch (err) {
    console.warn('Failed to enumerate preview devices:', err);
  }
}

/** Release both captures and reset the preview (leave, cancel, join). */
export function stopPreview() {
  cameraSeq++;
  micSeq++;
  releaseVideo();
  releaseAudio();
  cameraError = null;
  micError = null;
  backgroundError = null;
  cameraStarting = false;
  micStarting = false;
}

/**
 * @param {MediaDeviceInfo[]} devices
 * @param {string | null} preferred
 */
function pick(devices, preferred) {
  if (preferred && devices.some((d) => d.deviceId === preferred)) return preferred;
  return devices[0]?.deviceId ?? '';
}

function releaseVideo() {
  const track = videoTrack;
  videoTrack = null;
  // stop() destroys the track's processor; only our reference remains.
  bgProcessor = null;
  track?.stop();
}

function releaseAudio() {
  stopMeter();
  const track = audioTrack;
  audioTrack = null;
  track?.stop();
}

/** @param {import('livekit-client').LocalAudioTrack} track */
function startMeter(track) {
  stopMeter();
  try {
    analyser = createAudioAnalyser(track, { smoothingTimeConstant: 0.6 });
  } catch (err) {
    console.warn('Microphone level meter unavailable:', err);
    analyser = null;
    return;
  }
  // The lobby may open without a user gesture (remembered "mic on"): an
  // AudioContext created then starts suspended and reads 0 until resumed.
  const ctx = /** @type {AudioContext | undefined} */ (analyser.analyser.context);
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  const tick = () => {
    level = analyser?.calculateVolume() ?? 0;
    meterFrame = requestAnimationFrame(tick);
  };
  meterFrame = requestAnimationFrame(tick);
}

function stopMeter() {
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  level = 0;
  const current = analyser;
  analyser = null;
  current?.cleanup().catch(() => {});
}
