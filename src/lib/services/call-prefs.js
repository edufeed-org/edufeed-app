// Per-device call preferences, kept in localStorage: remembered mic /
// speaker / camera, browser audio processing flags, per-person playback
// volume, the screen share quality preset, whether the chat sits beside
// the call and the camera background effect. These are conveniences for
// this browser only — every read falls back to a default and every write is
// best effort, because storage can be blocked (private mode, cleared site
// data) and a call must still work without it.

import { parseBackgroundEffect } from '$lib/groups/call-background.js';

const PREFIX = 'edufeed:call:';
const DEVICE_KEYS = {
  audioinput: 'micDeviceId',
  audiooutput: 'speakerDeviceId',
  videoinput: 'cameraDeviceId'
};

/** @param {string} key */
function read(key) {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string | null} value */
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // best effort
  }
}

/** @param {string} key @param {any} fallback */
function readJson(key, fallback) {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {MediaDeviceKind} kind
 * @returns {string | null}
 */
export function getPreferredDevice(kind) {
  const key = DEVICE_KEYS[kind];
  return key ? read(key) || null : null;
}

/** @param {MediaDeviceKind} kind @param {string} deviceId */
export function rememberDevice(kind, deviceId) {
  const key = DEVICE_KEYS[kind];
  if (key) write(key, deviceId || null);
}

/** @typedef {{noiseSuppression: boolean, echoCancellation: boolean, autoGainControl: boolean}} AudioProcessing */

/** @type {AudioProcessing} */
const PROCESSING_DEFAULTS = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true
};

/** @returns {AudioProcessing} */
export function getAudioProcessing() {
  const stored = readJson('audioProcessing', {});
  /** @type {AudioProcessing} */
  const result = { ...PROCESSING_DEFAULTS };
  for (const key of /** @type {(keyof AudioProcessing)[]} */ (Object.keys(PROCESSING_DEFAULTS))) {
    if (typeof stored[key] === 'boolean') result[key] = stored[key];
  }
  return result;
}

/**
 * @param {Partial<AudioProcessing>} partial
 * @returns {AudioProcessing}
 */
export function setAudioProcessing(partial) {
  const next = { ...getAudioProcessing(), ...partial };
  write('audioProcessing', JSON.stringify(next));
  return next;
}

/**
 * Capture options for the microphone. Mono on purpose: a stereo interface
 * that only fills one channel otherwise publishes one-sided audio.
 */
export function micCaptureOptions() {
  const deviceId = getPreferredDevice('audioinput');
  return {
    ...(deviceId ? { deviceId } : {}),
    ...getAudioProcessing(),
    channelCount: 1
  };
}

export function cameraCaptureOptions() {
  const deviceId = getPreferredDevice('videoinput');
  return deviceId ? { deviceId } : {};
}

/** Playback volume per pubkey, 0..2 (Web Audio gain; 1 = unchanged). */
/** @param {string} pubkey */
export function getParticipantVolume(pubkey) {
  const volumes = readJson('volumes', {});
  const value = volumes[pubkey];
  return typeof value === 'number' && Number.isFinite(value) ? clampVolume(value) : 1;
}

/** @param {string} pubkey @param {number} volume */
export function setParticipantVolume(pubkey, volume) {
  const volumes = readJson('volumes', {});
  const value = clampVolume(volume);
  if (value === 1) delete volumes[pubkey];
  else volumes[pubkey] = value;
  write('volumes', JSON.stringify(volumes));
  return value;
}

/** @param {number} value */
function clampVolume(value) {
  return Math.min(2, Math.max(0, Number(value) || 0));
}

/**
 * Screen share presets: resolution + frame rate. Text-heavy teaching
 * content (slides, code) wants resolution over motion; video wants fps.
 */
export const SCREEN_SHARE_QUALITIES = {
  '720p15': { width: 1280, height: 720, frameRate: 15 },
  '1080p15': { width: 1920, height: 1080, frameRate: 15 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30 },
  '1440p30': { width: 2560, height: 1440, frameRate: 30 }
};

/** @typedef {keyof typeof SCREEN_SHARE_QUALITIES} ScreenShareQuality */

/** @returns {ScreenShareQuality} */
export function getScreenShareQuality() {
  const stored = read('screenShareQuality');
  return stored && stored in SCREEN_SHARE_QUALITIES
    ? /** @type {ScreenShareQuality} */ (stored)
    : '1080p30';
}

/** @param {string} quality */
export function setScreenShareQuality(quality) {
  if (quality in SCREEN_SHARE_QUALITIES) write('screenShareQuality', quality);
}

/**
 * "Ton teilen": whether a screen share also carries the tab's / system's
 * sound. Off by default — the browser then never offers audio in the picker.
 */
export function getScreenShareAudio() {
  return read('screenShareAudio') === '1';
}

/** @param {boolean} enabled */
export function setScreenShareAudio(enabled) {
  write('screenShareAudio', enabled ? '1' : '0');
}

/** Wide screens: chat as a column beside the call stage (off = stage only). */
// Open by default (QA 2026-10-02 C3: a closed chat had to be found first);
// an explicit toggle either way is remembered on this device.
export function getChatBeside() {
  return read('chatBeside') !== '0';
}

/** @param {boolean} beside */
export function setChatBeside(beside) {
  write('chatBeside', beside ? '1' : '0');
}

/** Camera background effect ('none' | 'blur' | 'custom' | 'preset:<id>'). */
export function getBackgroundEffect() {
  return parseBackgroundEffect(read('background'));
}

/** @param {string} effect */
export function setBackgroundEffect(effect) {
  write('background', parseBackgroundEffect(effect));
}

/** The own background image (downscaled JPEG data URL), or null. */
export function getCustomBackground() {
  return read('backgroundImage') || null;
}

/**
 * Keep the own background image on this device. Returns false when storage
 * refused it (full, blocked) — the caller tells the user instead of silently
 * losing the image on the next call.
 * @param {string} dataUrl
 */
export function setCustomBackground(dataUrl) {
  try {
    localStorage.setItem(PREFIX + 'backgroundImage', dataUrl);
    return true;
  } catch {
    return false;
  }
}
